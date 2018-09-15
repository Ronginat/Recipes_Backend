const AWS = require('aws-sdk');
const moment = require('moment-timezone');
const Promise = require('promise');

AWS.config.update({region: process.env['REGION']});
const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const documentClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

const freePatch = ["likes", "discussion"];
const authPatch = ["description", "categories"];
const forbidPatch = ["id", "name", "recipeFiles", "foodFiles", "createdAt", "sharedKey", "thumbnail", "uploader", "pendingImages", "lastModifiedAt"];


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

function getUploader(key) {
    let params = {
        "TableName": process.env['RECIPE_TABLE'],
        "Key": {
            "id": key,
            "sharedKey": process.env['SHARED_KEY']
        },
        "ProjectionExpression": "uploader"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.getItem(params, function(err, data) {
            if (err) {
                console.log("Error GET", err);
                return reject(err);
            } 
            else {
                if(data['Item'] == undefined) {
                    reject("item not found in recipes table");
                }
                else {
                    console.log("Success GET", data);
                    return resolve(data['Item']['uploader']['S']);
                }
            }
        });
    });
}

function updateItemInRecipes(id, attributes) {
    let expression = generateExpressionAttributes(attributes);

    let params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            'id' : id,
            'sharedKey': process.env['SHARED_KEY'],
        },
        UpdateExpression : expression.Updates,
        ExpressionAttributeValues : expression.Values,
        ReturnValues: "ALL_NEW"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        documentClient.update(params, function(err, data) {
            if (err) {
                console.log("Error recipe UPDATE", JSON.stringify(err, null, 2));
                return reject(err);
            } 
            else {
                console.log("Success recipe UPDATE", SON.stringify(data));
                return resolve(data['Attributes']);
            }
        });
    });
}

function generateExpressionAttributes(attributes) {
    let date = moment.tz("Asia/Jerusalem").format('YYYY-MM-DD HH:mm:ss');
    let Updates = "SET ";
    let Values = {};

    for(let value in attributes) {
        switch(value) {
            case "likes":
                Updates = Updates.concat("likes = likes + :likeValue, ");
                Values[':likeValue'] = 1;
                break;
            case "discussion":
                Updates = Updates.concat("discussion = list_append(discussion, :discussValue), ");
                Values[':discussValue'] = [attributes[value]];
                break;
            case "description":
                Updates = Updates.concat("description = :descValue, ");
                Values[':descValue'] = attributes[value];
                break;
            case "categories":
                Updates = Updates.concat("categories = :catValue, ");
                Values[':catValue'] = documentClient.createSet(attributes[value]);
                break;
        }
    }

    Updates = Updates.concat("lastModifiedAt = :dateValue");
    Values[':dateValue'] = date;

    return {
        "Updates": Updates,
        "Values": Values
    };
}


exports.handler = async function(event, context, callback) {
    let id = undefined, requiredAuth = false;
    let patchAttrs = [];

    try {
        if(event['queryStringParameters'] != undefined && event['queryStringParameters']['id'] != undefined) {
            id = event['queryStringParameters']['id'];
        }
        else {
            throw "request must contain recipe id";
        }
    
        let request = JSON.parse(event['body']);
    
        for(let key in request) {
            if(forbidPatch.includes(key)) {
                throw "requested property cannot be patched. " + key;
            }
            else{
                if(authPatch.includes(key)) {
                    requiredAuth = true;
                    patchAttrs.push(key);
                }
                else if(freePatch.includes(key)) {
                    patchAttrs.push(key);
                }
                else { // attribute not exists
                    throw "requested property not exists. " + key;
                }
            } 
        }

        if(requiredAuth) {
            //authorization check. only the uploader can change some attributes
            let username = await getUsername(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
            let uploader = await getUploader(id);

            if(username !== uploader) {
                throw "not authorized to change requested attributes!";
            }
        }

        //authorized or doing free patch. either way, a valid request
        let results = await updateItemInRecipes(id, request);

        callback(null, setResponse(200, JSON.stringify(results)));
    }
    catch(err) {
        callback(null, setResponse(400, err));
    }

};