const axios = require('axios');
const fuzz = require('fuzzball');
const admin = require('firebase-admin');
const csv = require('csv-parser')
const fs = require('fs')
const serviceAccount = require('FIRESTORE CREDENTIALS');
admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore()
//ignores undefined values inserted into firestore
admin.firestore().settings({
        ignoreUndefinedProperties:true,
})



srcImage =""
targetImage=""

//Compares uploaded selfie to parse photo from ID, uses image links as input
async function faceCompare(srcImage,targetImage){
        try {
                //sends images to pixlab facecompare endpoint and returns the field same_face which is a numeric confidence score
                const response = await axios.get('https://api.pixlab.io/facecompare',{
                        params:{
                                'key':'#################',
                                'src':srcImage,
                                'target':targetImage
                        }
        
                });
                return response.data.same_face;
              } catch (error) {
                console.error(error);
        }

}
//Parses text from ID Card
async function IDParsing(img,country){
        try {
                //Returns data parsed from ID
                const response = await axios.get('https://api.pixlab.io/docscan',{
                        params:{
                                'key':'##################',
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


//Parses text from a passport
async function PassportParse(img){
        try {
                //Returns data parsed from passport
                const response = await axios.get('https://api.pixlab.io/docscan',{
                        params:{
                                'key':'##################',
                                'img':img,
                                'type':'passport',
                        }
        
                });
                return response.data;
              } catch (error) {
                console.error(error);
        }
}


async function dataCompare(userInputJSON, IDparseJSON){
//Going to compare two json objects similarity 
}

//Compares name and address parsed from ID to data inputted into firestore
async function dataCompare(ufirstName,umiddleName,ulastName,IDParseJSON){
        var dataValidation;
        //firestore query
        await db.collection('users').where('firstName','==',ufirstName).where('middleName','==',umiddleName).where('lastName','==',ulastName).get().then((snapshot) => {
                snapshot.docs.forEach(doc => {
                        //fuzz ratio is numeric score that indicates string similarity, if the strings have a fuzz ratio more than 90, it is safe to assume they are the same
                        name_fuzz_ratio=fuzz.ratio(ufirstName+umiddleName+ulastName , IDParseJSON['name']);
                        address_fuzz_ratio=fuzz.ratio(doc.data().address1 , IDParseJSON["address"]);
                        if(name_fuzz_ratio >= 90 && address_fuzz_ratio >= 90){
                            //returns true if the data is the same
                                dataValidation = true;
                        }
                        else{
                                dataValidation = false;
                        }
                        
                })
        });
        return dataValidation;
}


//compares string parsed from a id's mrz and compares it to the user inputted name
async function MRZCompare(nameString,MRZString,){
        return(MRZString.includes(nameString) ? true : false);
}


//Takes name as input and checks to see if it exists in OFAC'S SDN list
async function ofacScreening(nameInput){
    var nameFound = false;
    const query = await db.collection('OFAC SDN').where('NAME','==',nameInput).get();
    query.forEach(doc => {
        if(doc.data()['NAME'].length > 1){
            nameFound = true;
        }
    })
    return nameFound;
}


//var sdnJSON = require('./sdn.json');

//Parses csv data from csv file(OFAC SDN CSV FILE) and enumerates through every entry, if the entry doesn't exist yet and it's not undefined, it inserts it into firestore.
async function ofacUpdate(csvFile){
    var readStream =fs.createReadStream(csvFile)
    .pipe(csv())
    .on('data', async (data) => {
        var existenceCheck = await ofacScreening(data['NAME']);
        if(existenceCheck != true && data['NAME'] != undefined){
                const res = db.collection('OFAC SDN').add({
                        NAME:data['NAME'],
                        SDNTYPE:data['SDNTYPE'],
                        PROGRAM:data['PROGRAM']
                });
        }
    })
    .on('error', function(error){
        console.log('Error');
     })
    .on('end',()=> {
        console.log("Success! Update Complete!");
    })
}


async function ofacCheckForUpdate(){
//The plan here is to use nodecron to frequently download the sdn.csv file, check the hash, and if it's different, use sed and awk to insert headers into the file(FOR THE CSV PARSER) and insert it into ofacUpdate
}

async function IDVerification(){
//The plan here is to use this function to contact an authoritative source for the ID(Such as DMV Database) to verify that it's not counterfeit
}

async function KYCVerification(){
//This is the primary function that will consolidate all the other functions as verification checks to eventually enable the KYC flag if it passes, otherwise not.
}


KYCVerification();
