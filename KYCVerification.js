const axios = require('axios');
const fuzz = require('fuzzball');
const admin = require('firebase-admin');
const csv = require('csv-parser')
const pdf = require('pdf-parse');
const fs = require('fs')
var cron = require('node-cron');
const https = require('https');
var crypto = require('crypto');
const { exec } = require("child_process");
const serviceAccount = require('./osupa-f56dd-firebase-adminsdk-x4l47-e2a1f979c2.json');

admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore()

admin.firestore().settings({
        ignoreUndefinedProperties:true,
})

var pixlabAPIkey;

//Images used for testing
//srcImage ="https://apscitu.com/Expert-IT-News/Articles/2018/10/08/Insecure_Facebook_Demands_Your_Passport_Bank_Statements_Medical_Records/FakeMarkZuckerbergPassport_488x324.png"
//targetImage="https://s3.amazonaws.com/pics.pixlab.xyz/BblNFPTCEAAvPZL.jpg"


async function faceCompare(srcImage,targetImage){
        try {
                const response = await axios.get('https://api.pixlab.io/facecompare',{
                        params:{
                                'key':pixlabAPIkey,
                                'src':srcImage,
                                'target':targetImage
                        }
        
                });
                return response.data.same_face;
              } catch (error) {
                console.error(error);
        }

}
async function IDParsing(img,country){
        try {
                const response = await axios.get('https://api.pixlab.io/docscan',{
                        params:{
                                'key':pixlabAPIkey,
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
        return dataValidation;
}



async function MRZCompare(nameString,MRZString,){
        return(MRZString.includes(nameString) ? true : false);
}



async function PEPScreening(firstName,lastName){
        var nameFound = false;
        //const query = await db.collection('CIA PEP').where('LASTNAME','==',nameInput).get();
        const query = await db.collection('CIA PEP').where('FIRSTNAME','>=',firstName).where("LASTNAME", '>=', lastName).get();
        query.forEach(doc => {
            if(doc.data()['FIRSTNAME'].length > 1){
                nameFound = true;
            }
        })
        return nameFound;
}

async function ofacScreening(firstName,lastName){
    //fullNameArray=data['NAME'].split(",");
    var nameFound = false;
    const query = await db.collection('OFAC SDN').where('FIRSTNAME','>=',firstName).where("LASTNAME", '>=', lastName).get();
    query.forEach(doc => {
        if(doc.data()['FIRSTNAME'].length > 1){
            nameFound = true;
        }
    })
    return nameFound;
}



async function PEPupdate(PEPfile){
        var lastName;
        let dataBuffer = fs.readFileSync(PEPfile);
        pdf(dataBuffer).then(function(data) {
                PEPArray=data.text.split("\n");
                PEPArray.forEach(element =>{
                        splitCases=element.split(/(\b[A-Z][A-Z]+|\b[A-Z]\b)/g);
                        console.log(splitCases);
                        if(splitCases.length > 2){
                                //combines remaining elements of array if uppercase portion(last name) is more than one word
                                combineUppercase=splitCases.slice(1,splitCases.length).join();
                                lastName=combineUppercase.replace(/\,/g,"");
                        }
                        //if(!(element.includes("Min.")  || element.includes("Pres.") || element.includes("Sec.")  || element.includes("Dep."))){
                                
                        const res = db.collection('CIA PEP').add({
                                FIRSTNAME:splitCases[0],
                                LASTNAME:lastName
                        });
                });
                
            });
}

//var sdnJSON = require('./sdn.json');
const { Console } = require('console');
async function ofacUpdate(csvFile){
    var readStream =fs.createReadStream(csvFile)
    .pipe(csv())
    .on('data', async (data) => {
        try{
                fullNameArray=data['NAME'].split(",");
                var existenceCheck = await ofacScreening(fullNameArray[0],fullNameArray[1]);
                if(existenceCheck != true && data['NAME'] != undefined){
                        if(data['SDNTYPE']=="individual"){
                                const res = db.collection('OFAC SDN').add({
                                        LASTNAME:fullNameArray[0],
                                        FIRSTNAME:fullNameArray[1],
                                        SDNTYPE:data['SDNTYPE'],
                                        PROGRAM:data['PROGRAM']
                                });
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

/*
async function ofacDeleteThenUpdate(){
        db.collection("OFAC SDN").get().then(function(querySnapshot) {
                querySnapshot.forEach( async function(doc) {
                        const res = await db.collection('OFAC SDN').doc(doc).delete();
                    
                });
            });
}
*/


async function getSdnHash(){
        var firestoreHash;
        const firestoreHashQuery = await db.collection('KYCTesting').where('sdnFileHash','!=', false).get();
        firestoreHashQuery.forEach(doc => {
                firestoreHash=doc.data()["sdnFileHash"];
        })
        return firestoreHash;
}


cron.schedule('30 3 15 * *', async () => {
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
                    pipe(crypto.createHash('sha256').setEncoding('hex')).
                    on('finish', async function () {
                       fileHash=this.read();
                       if(fileHash != firestoreHash){
                                const data = {sdnFileHash:fileHash};
                                console.log(data);
                                const res = await db.collection('KYCTesting').doc('sdnSHA256').set(data);
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
                                await ofacUpdate(path);
                                fs.unlinkSync(path);
                       }
                       else{
                               console.log("hash is same")
                                fs.unlinkSync(path);
                       }
                    })
                })
            })
});




async function setPixlabApiKey(){
    const apiKeyQuery = await db.collection('KYCTesting').where('PIXLABAPIKEY','!=', false).get();
    apiKeyQuery.forEach(doc => {
            pixlabAPIkey=doc.data();
    })
}

async function KYCVerification(){

    //ofacCheckForUpdate();
    //ofacUpdate("newsdn.csv");
    //PEPupdate('PEP.pdf');
    //b= await PEPScreening("KULFAS");
    //console.log(b);
}


KYCVerification();
