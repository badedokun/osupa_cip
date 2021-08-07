const axios = require('axios');
const fuzz = require('fuzzball');
const admin = require('firebase-admin');
const csv = require('csv-parser')
const pdf = require('pdf-parse');
const fs = require('fs')
var cron = require('node-cron');
const https = require('https');
var crypto = require('crypto');
const plaid = require("plaid");
const { exec } = require("child_process");
const serviceAccount = require('./osupa-f56dd-firebase-adminsdk-x4l47-e2a1f979c2.json');
var pixlabAPIkey;
var plaidClient;

//firestore settings
admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore()

admin.firestore().settings({
        ignoreUndefinedProperties:true,
})


/**
 * This function accepts two strings as arguments that are expected to be paths/urls to an image, submits them to the pixlab faceCompare endpoint, and receives a integer confidence value
 * 
 * @param {String} srcImage Can be user uploaded selfie(stored in firebase)
 * @param {String} targetImage Can be photo of ID
 * @returns {Integer} Returns 20 to increment to the KYC score if the confidence score is above 0.80, otherwise return 0
 */
async function faceCompare(srcImage,targetImage){
        try {
                //sends data to pixlab
                const response = await axios.get('https://api.pixlab.io/facecompare',{
                        params:{
                                'key':pixlabAPIkey,
                                'src':srcImage,
                                'target':targetImage
                        }
        
                });
                //Two different response options:
                //console.log(response.data.confidence);
                //console.log(response.data.same_face);
                if(response.data.confidence >= 0.80){
                        return 20
                }
                else{
                        return 0;
                }
              } catch (error) {
                console.error(error);
        }

}

/**
 * This function receives an driver's license ID image as an argument, submits the image to pixlab's docscan endpoint, and receives a json object containing the data parsed from the ID
 * 
 * @param {String} img Image of driver's license
 * @param {String} country Country that the license belongs to, argument can be full string or country ISO code
 * @returns {Object} returns json object containing data parsed from the driver's license
 */
async function IDParsing(img,country){
        try {
                const response = await axios.get('https://api.pixlab.io/docscan',{
                        params:{
                                'key':'pixlabAPIkey',
                                'img':img,
                                'type':'idcard',
                                'country':country
                        }
        
                });
                return response.data.fields;
              } catch (error) {
                console.error(error);
        }
}

/**
 * This function is similar to IDParsing but for passports, receives a string expected to be a path to an passport image, submits to pixlab, and receives parsed data back
 * @param {String} img Photo of passport
 * @returns {Object} Returns json object containing parsed data from passport
 */
async function PassportParse(img){
        try {
                const response = await axios.get('https://api.pixlab.io/docscan',{
                        params:{
                                'key':pixlabAPIkey,
                                'img':img,
                                'type':'passport',
                        }
        
                });
                return response.data;
              } catch (error) {
                console.error(error);
        }
}


/**
 * This function receives a first, middle, and last name(from user collection in firestore) and a json object containing data parsed from an ID from either PassportParse or IDParsing,
 * it compares the address and name fields from firestore to the address and name fields parsed from the ID with a fuzz ratio. Fuzz ratio indicates string similarity, if the compared
 * strings are more than 90% similar, they are assumed to be the same and the function returns 20, indicating that the information from the ID is the same as what they entered in the ui
 * 
 * @param {String} ufirstName user's first name from firestore
 * @param {String} umiddleName user's middle name from firestore
 * @param {String} ulastName user's last name from firestore
 * @param {Object} IDParseJSON JSON object from IDParsing() function 
 * @returns {Integer} Returns 20 if fuzz ratio is more than or equal to 90, otherwise returns 0 and the data is assumed to not be the same
 */
async function dataCompare(ufirstName,umiddleName,ulastName,IDParseJSON){
        var dataValidation;
        await db.collection('users').where('firstName','==',ufirstName).where('middleName','==',umiddleName).where('lastName','==',ulastName).get().then((snapshot) => {
                snapshot.docs.forEach(doc => {
                        name_fuzz_ratio=fuzz.ratio(ufirstName+umiddleName+ulastName , IDParseJSON['name']);
                        address_fuzz_ratio=fuzz.ratio(doc.data().address1 , IDParseJSON["address"]);
                        //dob_fuzz_ratio
                        if(name_fuzz_ratio >= 90 && address_fuzz_ratio >= 90){
                                dataValidation = true;
                        }
                        else{
                                dataValidation = false;
                        }
                        
                })
        });
        if(dataValidation==true){
                return 20;
        }
        else{
                return 0;
        }
}


/**
 * This function tests to see if a name substring is located in parsed MRZ data obtained from pixlab's api. Can be used to verify that an ID is not counterfeit.
 *  
 * @param {String} nameString Name of user
 * @param {String} MRZString MRZ Data obtained from pixlab
 * @returns {Boolean} returns true if mrz contains a substring that is the name passed in nameString
 */
async function MRZCompare(nameString,MRZString,){
        return(MRZString.includes(nameString) ? true : false);
}


/**
 * This function can be used to query the CIA PEP list located in firestore
 * 
 * @param {String} firstName first name for querying
 * @param {String} lastName last name for querying
 * @returns {Integer} returns 0 if name is found, 20 if not
 */
async function PEPScreening(firstName,lastName){
        var nameFound = false;
        //performs a touppercase() on lastname, because in the collection all lastnames are uppercase
        const query = await db.collection('CIA PEP').where('FIRSTNAME','==',firstName.trim()).where("LASTNAME", '==', lastName.trim().toUpperCase()).get();
        query.forEach(doc => {
                //if length >1 it is assumed that it exists
            if(doc.data()['FIRSTNAME'].length > 1){
                nameFound = true;
            }
        })
        if(nameFound!=true){
                return 20;
        }
        else{
                return 0;
        }
}

/**
 * This function can be used to query the ofac SDN list located in firestore
 * @param {*} firstName first name for querying
 * @param {*} lastName last name for querying
 * @returns {Integer} returns 0 if name is found, 20 if not
 */
async function ofacScreening(firstName,lastName){
    var nameFound = false;
    const query = await db.collection('OFAC SDN').where('FIRSTNAME','==',firstName.trim()).where("LASTNAME", '==', lastName.trim().toUpperCase()).get();
    query.forEach(doc => {
        if(doc.data()['FIRSTNAME'].length > 1){
            nameFound = true;
        }
    })
    if(nameFound!=true){
            return 20;
    }
    else{
            return 0;
    }
}


/**
 * This function receives a pdf of the cia pep file(the official pdf from their website) and iterates line by line and inserts the information into the firestore collection CIA PEP
 * @param {String} PEPfile String containing a path to the CIA PEP pdf file obtained from their website
 */
async function PEPupdate(PEPfile){
        var lastName;
        let dataBuffer = fs.readFileSync(PEPfile);
        pdf(dataBuffer).then(function(data) {
                PEPArray=data.text.split("\n");
                PEPArray.forEach(element =>{
                        splitCases=element.split(/(\b[A-Z][A-Z]+|\b[A-Z]\b)/g);
                        //console.log(splitCases);
                        if(splitCases.length > 2){
                                //combines remaining elements of array if uppercase portion(last name) is more than one word
                                combineUppercase=splitCases.slice(1,splitCases.length).join();
                                lastName=combineUppercase.replace(/\,/g,"");
                        }
                        //if(!(element.includes("Min.")  || element.includes("Pres.") || element.includes("Sec.")  || element.includes("Dep."))){
                        if(splitCases[0] != undefined && lastName != undefined){ 
                                const res = db.collection('CIA PEP').add({
                                        FIRSTNAME:splitCases[0].trim(),
                                        LASTNAME:lastName.trim()
                                });
                        }
                });
                
            });
}

//used for ofacupdate
//ofacUpdate uses this function instead of ofacScreening for querying OFAC SDN
async function ofacExistenceCheck(lastName,firstName){
        var nameFound = false;
        const query = await db.collection('OFAC SDN').where('LASTNAME','==',lastName).where("FIRSTNAME", '==', firstName).get();
        query.forEach(doc => {
                nameFound = true;
        });
        return nameFound;
}



const { Console } = require('console');
/**
 * This function receives the ofac sdn csv file, iterates through it, formats and parses the names, performs an existence check, and if the name doesn't already exist in firestore the functions adds it to the collection
 * @param {String} csvFile This should be a path to the csv file obtained from https://www.treasury.gov/ofac/downloads/sdn.csv
 */

async function ofacUpdate(csvFile){
    var readStream =fs.createReadStream(csvFile)
    .pipe(csv())
    .on('data', async (data) => {
            //console.log(data);
        //Existence check
        try{
                if(data['SDNTYPE']=='individual'){
                        var name=data['NAME'].split(",");
                        if(name[0] != null && name[1] != null){
                                var doesExist = await ofacExistenceCheck(name[0].trim(),name[1].trim());
                        }
                }
        }
        catch(err){
                console.log(err);
        }
        //Adds name to firestore
        try{
                fullNameArray=data['NAME'].split(",");
                //To prevent undefined values from being passed into the collection
                if(fullNameArray[0]==null || fullNameArray[1]==null){
                }
                else{
                        if(data['NAME'] != undefined){
                                //if name doesn't exist in firestore, and if it's an individual, put into firestore collection OFAC SDN
                                if(data['SDNTYPE']=="individual" && doesExist == false){
                                        //console.log("Adding"+fullNameArray[0]+fullNameArray[1]);
                                        const res = db.collection('OFAC SDN').add({
                                                LASTNAME:fullNameArray[0].trim(),
                                                FIRSTNAME:fullNameArray[1].trim(),
                                                SDNTYPE:data['SDNTYPE'],
                                                PROGRAM:data['PROGRAM']
                                        });
                                }
                        }
                }
        }
        catch(err){
                console.log(err);
        }
    })
    .on('error', function(error){
        console.log('Error');
     })
    .on('end',()=> {
        console.log("Success! Update Complete!");
    })
}

/**
 * This function retrieves a hash of the sdn.csv file stored in firestore as sdnFileHash
 * @returns {String} returns hash of sdn.csv file located in firestore
 */
async function getSdnHash(){
        var firestoreHash;
        const firestoreHashQuery = await db.collection('KYCTesting').where('sdnFileHash','!=', false).get();
        firestoreHashQuery.forEach(doc => {
                firestoreHash=doc.data()["sdnFileHash"];
        })
        return firestoreHash;
}



/**
 * This function is a cron job that periodically runs at 3:30am on the 15th of every month, it downloads the sdn.csv file, hashes the file, compares the hash to the previous generated hash located in firestore, if they differ then the function uses sed to add required
 * headings to sdn.csv for csvparse() in ofacUpdate() and then passes the file to ofacUpdate
 */
cron.schedule('30 3 15 * *', async () => {
        //Download file
        var firestoreHash = await getSdnHash();
        const SDNurl = "https://www.treasury.gov/ofac/downloads/sdn.csv";    
        var fileHash;
        const path = `/tmp/sdn.csv`; 
        https.get(SDNurl,(res) => {
                const filePath = fs.createWriteStream(path);
                res.pipe(filePath);
                filePath.on('finish',() => {
                    filePath.close();
                    fs.createReadStream(path).
                    //Create hash of file
                    pipe(crypto.createHash('sha256').setEncoding('hex')).
                    on('finish', async function () {
                       fileHash=this.read();
                       //compare hash of file
                       if(fileHash != firestoreHash){
                                const data = {sdnFileHash:fileHash};
                                console.log(data);
                                //sets new hash if there is disparity
                                const res = await db.collection('KYCTesting').doc('sdnSHA256').set(data);
                                //uses sed subprocess to add headings to first line of sdn.csv
                                exec("sed -i -e '1iID,NAME,SDNTYPE,PROGRAM\' "+path, (error, stdout, stderr) => {
                                        if (error) {
                                            console.log(`error: ${error.message}`);
                                            return;
                                        }
                                        if (stderr) {
                                            console.log(`stderr: ${stderr}`);
                                            return;
                                        }
                                        console.log(`stdout: ${stdout}`);
                                    });
                                //retrieves an integer to identify read stream
                                //closes read stream to not interfere with readstream in ofacupdate
                                file_descriptor = fs.openSync(path);
                                fs.close(file_descriptor,(err) => {
                                        if (err)
                                          console.error('Failed to close file', err);
                                        else {
                                          console.log("\n> File Closed successfully");
                                        }
                                      });
                                //await ofacUpdate(path);
                                //fs.unlinkSync(path);
                       }
                       /*
                       else{
                               console.log("hash is same")
                                fs.unlinkSync(path);
                       }*/
                    })
                })
            })
            //passes new file into ofacUpdate() and deletes it when finished
            await ofacUpdate(path);
            fs.unlinkSync(path);
});



/**
 * sets global variable pixlabAPIkey with value obtained from firestore
 */
async function setPixlabApiKey(){
    const apiKeyQuery = await db.collection('KYCTesting').where('PIXLABAPIKEY','!=', false).get();
    apiKeyQuery.forEach(doc => {
            pixlabAPIkey=doc.data()['PIXLABAPIKEY'];
    })
}


//var plaidClient;
/**
 * Initializes plaid with credentials from firestore and then creates a plaid client, assigning it to global variable plaidClient.
 */
async function plaidInit(){
        const clientIDKeyQuery = await db.collection('KYCTesting').where('clientID','!=', false).get();
        clientIDKeyQuery.forEach(doc => {
                plaidClientID=doc.data()['clientID'];
        })

        const secretIDKeyQuery = await db.collection('KYCTesting').where('secretID','!=', false).get();
        clientIDKeyQuery.forEach(doc => {
                plaidSecretKey=doc.data()['secretID'];
        })

        var plaidClientID;
        var plaidSecretKey;
        plaidClient = new plaid.Client({
                clientID:plaidClientID,
                secret:plaidSecretKey,
                env:plaid.environments.sandbox
        });
}

/**
 * This function accepts a bank account number(as a string) and plaid accesstoken as arguments to access the Auth product and uses the function
 * getAuth() to retrieve a user's bank information in the form of a json object, the function then iterates through the account numbers retrieved
 * and compares them to the submitted bank account number to verify that the bank account number submitted by the user is the same as the account number in plaid, if
 * this results in being true, the function returns 20 to be incremented to the kyc score.
 * 
 * @param {String} bankNumber Bank account number of user
 * @param {String} accessToken Access token of plaid item(user) to access the product
 * @returns {Integer} returns 20 if submitted bank account number is the same as the one obtained from plaid 
 */
async function bankAccount(bankNumber,accessToken){
        const response = await plaidClient.getAuth(accessToken, {}).catch((err) => {
          console.log(err);
        });
      //account is an integer that represents index 
        for (account in response.numbers['ach']){
                if(bankNumber == response.numbers['ach'][account]['account']){
                        //console.log('found');
                        return 20;
                }
        }
        return 0;
}


//images used for testing
srcImage ="https://apscitu.com/Expert-IT-News/Articles/2018/10/08/Insecure_Facebook_Demands_Your_Passport_Bank_Statements_Medical_Records/FakeMarkZuckerbergPassport_488x324.png"
targetImage="https://s3.amazonaws.com/pics.pixlab.xyz/BblNFPTCEAAvPZL.jpg"

/**
 * This function is the primary function that congregates all the other functions into a step by step KYC verification process, with each function passing or failing, being
 * incremented to the total KYC Score. Since there are 5 steps, each step that is passed will increment 20 to the KYC score.
 * @returns {Integer} this is the sum of the kyc score. The range <50 fails, 50-80 requires manual verification, while > 80 passes and the kyc flag is set and approved
 */
async function KYCVerification(){
    var KYCScore;
    await setPixlabApiKey();
    await plaidInit();
    var IDParseResponse= await IDParsing('https://s3.amazonaws.com/pics.pixlab.xyz/BblNFPTCEAAvPZL.jpg','malaysia');
    //console.log(IDParseResponse);
    var faceCompareResponse= await faceCompare('https://s3.amazonaws.com/pics.pixlab.xyz/BblNFPTCEAAvPZL.jpg','https://i.imgur.com/Ht9gCT4.jpeg');
    KYCScore+=faceCompareResponse;
    console.log(faceCompareResponse);
    var dataCompareResponse= await dataCompare('DATO','','Hussin',IDParseResponse);
    KYCScore+=dataCompareResponse;
    console.log(dataCompareResponse);
    var sdnResponse = await ofacScreening('Elvert Dowie','BODDEN GALE');
    KYCScore+=sdnResponse;
     console.log(sdnResponse);
     var PEPResponse= await PEPScreening('Frederic ','LOUA');
     KYCScore=+PEPResponse;
     console.log(PEPResponse);
     var bankResponse= await bankAccount('',"");
     KYCScore+=bankResponse;
     console.log(bankResponse);
     return KYCScore;

}


KYCVerification();
