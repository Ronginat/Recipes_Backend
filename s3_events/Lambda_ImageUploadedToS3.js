const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
// const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();


// function getUsername(token){
//     let params = {
//         AccessToken: token
//       };
//     return new Promise((resolve, reject) => {
//         cognitoidentityserviceprovider.getUser(params, function(err, data) {
//             if (err) {
//                 console.log(err); // an error occurred
//                 return reject(err);
//             }
//             else {
//                 console.log(data); // successful response
//                 return resolve(data.Username);
//             }    
//         });
//     });
// }

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

function updateItemInPending(pendItem) {
    const date = dateToString();
    //"sharedKey": {"S": process.env['SHARED_KEY']},

    let params = {
        TableName: process.env['PEND_TABLE'],
        Key: {
            "id" : {"S": pendItem.id}
        },
        UpdateExpression : "SET #attrList = list_append(#attrList, :listValue), #attrDate = :dateValue",
        ExpressionAttributeNames : {
            "#attrList" : "pendImages",
            "#attrDate": "lastModifiedAt"
        },
        ExpressionAttributeValues : {
            ":listValue": {"L": [ { "S": pendItem.imageName }]},
            ":dateValue": {"S": date}
        },
        ReturnValues: "UPDATED_NEW "
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

function removeImageFromPending(key) {
    let params = {
        "TableName": process.env['PEND_IMG_TABLE'],
        "Key": {
            "fileName": key
        },
        "ReturnValues": "ALL_OLD"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.delete(params, function(err, data) {
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

function deleteFromS3(bucket, key) {
    let params = {
        Bucket: bucket, 
        Key: key
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        s3.deleteObject(params, function(err, data) {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject(err);
            }
            else {
                console.log(data); // successful response
                resolve(data);
            }
        });
    });
    
}

//---------------not used lambda---------------
exports.handler = async function(event, context) {
    let record = event['Records'][0]['s3'];
    let uploadedName = record['object']['key'];
    let bucket = record['bucket']['name'];

    try {
        let removedPend = await removeImageFromPending(uploadedName);
        let updatedRecipeItem = await updateItemInPending(removedPend);
        
        console.log("recipe upload successfully.\n" + JSON.stringify(updatedRecipeItem));

    } catch(err) {
        console.log("error when uploading recipe.\n" + err);
        console.log("deleting file from bucket...");
        await deleteFromS3(bucket, uploadedName);
    }
};