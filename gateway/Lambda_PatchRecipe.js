const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
//const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const documentClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

const freePatch = ["likes", "comments"];
const authPatch = ["description", "categories"];
const forbidPatch = ["id", "name", "recipeFile", "foodFiles", "createdAt", "sharedKey", "uploader", "lastModifiedAt"];


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
        documentClient.get(params, function(err, data) {
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
                console.log("Success recipe UPDATE", JSON.stringify(data));
                return resolve(data['Attributes']);
            }
        });
    });
}

function generateExpressionAttributes(attributes) {
    //let date = moment.tz("Asia/Jerusalem").format('YYYY-MM-DD HH:mm:ss');
    let date = dateToString();
    let Updates = "SET ";
    let Values = {};

    for(let value in attributes) {
        switch(value) {
            case "likes":
                Updates = Updates.concat("likes = likes + :likeValue, ");
                if (attributes[value] === 'like')
                    Values[':likeValue'] = 1;
                else
                    Values[':likeValue'] = -1;
                break;
            case "comments":
                Updates = Updates.concat("comments = list_append(comments, :commValue), ");
                Values[':commValue'] = [attributes[value]];
                break;
            case "description":
                Updates = Updates.concat("description = :descValue, ");
                Values[':descValue'] = attributes[value];
                break;
            case "categories":
                Updates = Updates.concat("categories = :catValue, ");
                Values[':catValue'] = attributes[value];
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

    console.log(event['body']);


    try {
        if(event['queryStringParameters'] != undefined && event['queryStringParameters']['id'] != undefined) {
            id = event['queryStringParameters']['id'];
        }
        else {
            throw "request must contain recipe id";
        }
    
        const request = JSON.parse(event['body']);
        //let request = JSON.parse(event['body']['attributes']);
    
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