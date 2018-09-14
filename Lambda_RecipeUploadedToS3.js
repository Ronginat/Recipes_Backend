const AWS = require('aws-sdk');
const moment = require('moment-timezone');
const Promise = require('promise');

AWS.config.update({region: process.env['REGION']});
const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
//const s3 = new AWS.S3();
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

function updateItemInRecipes(pendItem) {
    let date = moment.tz("Asia/Jerusalem").format('YYYY-MM-DD HH:mm:ss');

    let params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            Key: {
                'id' : {S: pendItem.id},
                'sharedKey': process.env['SHARED_KEY'],
            },
            'lastModifiedAt': {S: date},
            UpdateExpression : "SET #attrList = list_append(#attrList, :listValue), #attrDate = :dateValue",
            ExpressionAttributeNames : {
                "#attrList" : "recipeFiles",
                "#attrDate": "lastModifiedAt"
            },
            ExpressionAttributeValues : {
                ":listValue": {"L": [ { "S": pendItem.fileName }]},
                ":dateValue": {"S": date}
            },
            ReturnValues: "ALL_OLD | ALL_NEW"
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.updateItem(params, function(err, data) {
            if (err) {
                console.log("Error recipe UPDATE", err);
                return reject(err);
            } 
            else {
                if(data['Attributes'] == null) {
                    reject("error linking the file with recipe in db");
                }
                else {
                    console.log("Success recipe UPDATE", data);
                    return resolve(data['Attributes']);
                }
            }
        });
    });
}

function removeFromPending(key) {
    let params = {
        "TableName": process.env['PEND_TABLE'],
        "Key": {
            "fileName": key
        },
        "ReturnValues": "ALL_OLD"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.deleteItem(params, function(err, data) {
            if (err) {
                console.log("Error pend DELETE", err);
                return reject(err);
            } 
            else {
                if(data['Attributes'] == null) {
                    reject("uploaded file not found in pending table");
                }
                else {
                    console.log("Success pend DELETE", data);
                    return resolve(data['Attributes']);
                }
            }
        });
    });
}

exports.handler = async function(event, context, callback) {
    let record = event['body']['Records'][0]['s3'];
    let uploadedName = record['object']['key'];
    //let uploadedBucket = record['bucket']['name'];

    try {
        let results = {};

        let removedPend = await removeFromPending(uploadedName);
        let updatedRecipeItem = await updateItemInRecipes(removedPend);
        
        results['Item'] = updatedRecipeItem;

        callback(null, setResponse(200, results));

    } catch(err) {
        result['message'] = err;
        callback(null, setResponse(400, results));
    }
};