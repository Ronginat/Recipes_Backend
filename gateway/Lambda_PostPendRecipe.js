const AWS = require('aws-sdk');
const nanoid = require('nanoid');
//const Promise = require('promise');

AWS.config.update({region: process.env['REGION']});
//const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();


function setResponse(status, body){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
    return response;
}

function dateToString() {
    const date = new Date();
    var day = date.getUTCDate();
    var month = date.getUTCMonth() + 1;
    var year = date.getUTCFullYear();

    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();

    return '' + year + '-' + (month <= 9 ? '0' + month : month) + '-' + (day <= 9 ? '0' + day : day)
            + ' ' + (hours <= 9 ? '0' + hours : hours) + ':' + (minutes <= 9 ? '0' + minutes : minutes)
            + ':' + (seconds <= 9 ? '0' + seconds : seconds);
}

function getUsername(token){
    let params = {
        AccessToken: token
    };
    return new Promise((resolve, reject) => {
        cognitoidentityserviceprovider.getUser(params, function(err, data) {
            if (err) {
                console.log(err); // an error occurred
                return reject(err);
            }
            else {
                console.log(data); // successful response
                return resolve(data.Username);
            }    
        });
    });
}

function putRecipeInPendings(recipe, contentFile) {
    const date = dateToString();

    const params = {
        TableName: process.env['PEND_RECIPE_TABLE'],
        Item: {
            'id' : recipe.id,
            'recipeFile': contentFile,
            'name' : recipe.name,
            'description': recipe.description,
            'uploader': recipe.uploader,
            'categories': recipe.categories,
            'creationDate': date
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(params, function(err, data) {
            if (err) {
                console.log("Error recipe PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe PUT", data);
                return resolve(data);
            }
        });
    });
}

// function addFilesToPendings(recipe, fileNames) {
//     //const date = dateToString();
//     const Table = process.env['PEND_HTML'];

//     let i = 0, filesArray = [];
//     for(i = 0; i < fileNames.length; i++) {
//         filesArray.push({
//             PutRequest: {
//                 Item: {
//                     "fileName": {"S": fileNames[i]},
//                     "createdAt": {"S": recipe.createdAt},
//                     "id" : {"S": recipe.id},
//                     "uploader": {"S": recipe.uploader}
//                 }
//             }
//         });
//     }

//     const params = {
//         RequestItems: {
//             Table: filesArray
//         }
//     };

//     return new Promise((resolve, reject) => {
//         // Call DynamoDB to add the item to the table
//         ddb.batchWriteItem(params, function(err, data) {
//             if (err) {
//                 console.log("Error pend batch PUT", err);
//                 return reject(err);
//             } 
//             else {
//                 console.log("Success pend batch PUT", data);
//                 // data['UnproccessedItems'].forEach(element => {
//                 //     results.push(element['PutRequest']['fileName']);
//                 // });
//                 return resolve(data);
//             }
//         });
//     });
// }

// function generateImagesNames(numOfFiles, recipe, extension) {
//     let allowedExtenstions = ["jpg", "jpeg", "png"];
//     if(!allowedExtenstions.includes(extension)) {
//         throw "extention not supported";
//     }
//     else if(numOfFiles > process.env['MAX_FILES_PER_UPLOAD']) {
//         throw "too many files!";
//     }
//     else {
//         //let i, name = process.env['IMAGES_FOLDER'] + "/" + recipe.name;
//         const name = recipe.name;
//         let i, files = [];
//         for(i = 0; i < numOfFiles; i++){
//             files[i] = name + i.toString() + "---" + recipe.id + "." + extension;
//         }
//         return files;
//     }
// }

function generateContentName(recipe) {
    //let name = process.env['CONTENT_FOLDER'] + "/" + recipe.name, extension = "html";
    let name = 'recipe', extension = "html";
    return name + "---" + recipe.id + "." + extension;
}

function signUrl(fileName) {
    const myBucket = process.env['BUCKET'];
    const signedUrlExpireSeconds = 60 * 5; //5 minutes

    let params = {
        Bucket: myBucket,
        Expires: signedUrlExpireSeconds
    };

    params['Key'] =  process.env['CONTENT_FOLDER'] + "/" + fileName;
    return s3.getSignedUrl('putObject', params);
}

// function signUrls(fileNames) {
//     const myBucket = process.env['BUCKET'];
//     const signedUrlExpireSeconds = 60 * 5; //5 minutes
//     let i = 0;

//     let params = {
//         Bucket: myBucket,
//         Key: fileNames[i],
//         Expires: signedUrlExpireSeconds
//     };

//     let urls = [];
//     for(i = 0; i < fileNames.length; i++) {
//         params['Key'] = fileNames[i];
//         urls[i] = s3.getSignedUrl('putObject', params);
//     }

//     return urls;
// }

exports.handler = async function(event, context, callback) {
    console.log(event);

    // let results = {};
    // results['url'] = "url response from server"
    // callback(null, setResponse(200, JSON.stringify(results)));
    let eventBody = JSON.parse(event['body']);
    //let categories = JSON.parse(body.categories);

    try {
        let results = {};
                           //let username = await getUsername(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
        eventBody['recipe']['uploader'] = await getUsername(event['headers']['Authorization']);
        console.log('username: ' + eventBody['recipe']['uploader']);
        const newId = nanoid(12);
        console.log('generated id = ' + newId);
        eventBody['recipe']['id'] = newId;
        //let imagesNames = generateImagesNames(eventBody['numOfFiles'], eventBody, eventBody['extension']);
        let htmlName = generateContentName(eventBody['recipe']);
        console.log('generated html file name: ' + htmlName);
        let recipeItem = await putRecipeInPendings(eventBody['recipe'], htmlName);  
        console.log('recipe item in db: \n' + JSON.stringify(recipeItem));
        //let pend = await addHtmlToPendings(recipeItem, fileNames);
        //let urls = {};
        //urls['images'] = signUrls(imagesNames);
        const url = signUrl(htmlName);
        console.log('signed url: ' + url);

        //if (Object.keys(pend.UnprocessedItems).length === 0)

        results['Item'] = recipeItem;
        //results['imagesNames'] = imagesNames;
        results['url'] = url;
        
        callback(null, setResponse(200, JSON.stringify(results)));        
    } catch(err) {
        console.log('got error, ' + err)
        callback(null, setResponse(400, err));
    }
};