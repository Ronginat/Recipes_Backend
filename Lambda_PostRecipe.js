const AWS = require('aws-sdk');
const uuidv4 = require('uuid/v4');
const shortid = require('shortid');
const moment = require('moment-timezone');
const Promise = require('promise');

AWS.config.update({region: process.env['REGION']});
const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
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

function putItemInRecipes(body, Username) {
    let date = moment.tz("Asia/Jerusalem").format('YYYY-MM-DD HH:mm:ss');

    let params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'id' : {S: uuidv4()},
            'sharedKey': process.env['SHARED_KEY'],
            'name' : {S: body.name},
            'description': {S: body},
            'uploader': {S: Username},
            'categories': {SS: JSON.parse(body.categories)},
            'createdAt': {S: date},
            'lastModifiedAt': {S: date},
            'likes': {N: 0},
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.putItem(params, function(err, data) {
            if (err) {
                console.log("Error recipe PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe PUT", data);
                return resolve(data.Item);
            }
        });
    });
}

function addToPending(recipe, fileNames) {
    const Table = process.env['PEND_TABLE'];
    let params = {
        RequestItems: {
            Table: [

            ]
        }
    };

    for(let i = 0; i < fileNames.length; i++) {
        params.RequestItems.Table.push({
            PutRequest: {
                Item: {
                    "fileName": {"S": fileNames[i]},
                    "createdAt": {"S": recipe.createdAt},
                    "id" : {"S": recipe.id},
                    "uploader": {"S": recipe.uploader}
                }
            }
        });
    }

    // let params = {
    //     TableName: process.env['PEND_TABLE'],
    //     Item: {
    //         'id' : {S: recipe.id},
    //         'uploader': {S: recipe.uploader},
    //         'files': {SS: fileNames},
    //         'createdAt': {S: recipe.createdAt},
    //     }
    // };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.batchWriteItem(params, function(err, data) {
            if (err) {
                console.log("Error pend batch PUT", err);
                return reject(err);
            } 
            else {
                let results = [];
                console.log("Success pend batch PUT", data);
                data['ItemCollectionMetrics'].forEach(element => {
                    results.push(element['ItemCollectionKey']['fileName']);
                });
                return resolve(results);
            }
        });
    });
}

function signUrls(fileNames) {
    const myBucket = process.env['BUCKET'];
    const myKeys = fileNames;
    const signedUrlExpireSeconds = 60 * 5; //5 minutes
    let i = 0;

    let params = {
        Bucket: myBucket,
        Key: myKeys[i],
        Expires: signedUrlExpireSeconds
    }

    let urls = [];
    for(i = 0; i < myKeys.length; i++) {
        params['Key'] = myKeys[i];
        urls[i] = s3.getSignedUrl('putObject', params, onUrl);
    }

    return urls;
}

function generateFileNames(numOfFiles, recipe) {
    let i, name = recipe.name;
    let files = [], genId = shortid.generate();
    for(i = 0; i < numOfFiles; i++){
        files[i] = name + i.toString() + "--" + genId + "." + process.env['FILE_EXTENTION'];
    }
    return files;
}

exports.handler = async function(event, context, callback) {
    let eventBody = event.body;
    //let categories = JSON.parse(body.categories);

    try {
        let results = {};
        let username = await getUsername(event.multyValueHeaders.Authorization[0].AccessToken);
        let recipeItem = await putItemInRecipes(eventBody, username);
        let fileNames = generateFileNames(numOfFiles, data.Item);
        let pend = await addToPending(eventBody.numOfFiles, data.Item, fileNames);
        let urls = signUrls(fileNames);

        results['Item'] = recipeItem;
        results['fileNames'] = fileNames;
        results['urls'] = urls;
        
        callback(setResponse(200, results));        
    } catch(err) {
        callback(setResponse(500, err));
    }
};