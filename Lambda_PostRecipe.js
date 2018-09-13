const AWS = require('aws-sdk');
const uuidv4 = require('uuid/v4');
const shortid = require('shortid');
const moment = require('moment-timezone');
const Promise = require('promise');

AWS.config.update({region: process.env['REGION']});
const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
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
                return resolve(data);
            }
        });
    });
}

function addToPending(numOfFiles, recipe) {
    let fileNames = generateFileNames(numOfFiles, recipe);

    let params = {
        TableName: process.env['PEND_TABLE'],
        Item: {
            'id' : {S: recipe.id},
            'uploader': {S: recipe.uploader},
            'files': {SS: fileNames},
            'createdAt': {S: recipe.createdAt},
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.putItem(params, function(err, data) {
            if (err) {
                console.log("Error pend PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success pend PUT", data);
                return resolve(data);
            }
        });
    });
}

function generateFileNames(numOfFiles, recipe) {
    let i, name = recipe.name;
    let files = [], genId = shortid.generate();
    for(i = 0; i < numOfFiles; i++){
        files[i] = name + i.toString() + "--" + genId + process.env['FILE_EXTENTION'];
    }
    return files;
}

exports.handler = async function(event, context, callback) {
    let eventBody = event.body;
    //let categories = JSON.parse(body.categories);

    try {
        let username = await getUsername(event.multyValueHeaders.Authorization[0].AccessToken);
        let data = await putItemInRecipes(eventBody, username);
        let pend = await addToPending(eventBody.numOfFiles, data.Item);
        data['pendFiles'] = pend.Item;
        callback(setResponse(200, data));        
    } catch(err) {
        callback(setResponse(500, err));
    }
};