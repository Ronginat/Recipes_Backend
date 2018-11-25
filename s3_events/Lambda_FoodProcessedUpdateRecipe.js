const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();


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

function updateItemInRecipes(pendItem) {
    const date = dateToString();

    let params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            "id" : {"S": pendItem.id},
            "sharedKey": {"S": process.env['SHARED_KEY']},
        },
        UpdateExpression : "SET #attrList = list_append(#attrList, :listValue), #attrDate = :dateValue",
        ExpressionAttributeNames : {
            "#attrList" : "foodFiles",
            "#attrDate": "lastModifiedAt"
        },
        ExpressionAttributeValues : {
            ":listValue": {"L": [ { "S": pendItem.fileName }]},
            ":dateValue": {"S": date}
        },
        ConditionExpression: "attribute_exists(#attrList)",
        ReturnValues: "UPDATED_NEW"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.updateItem(params, function(err, data) {
            if (err) {
                console.log("Error recipe First UPDATE", err);
                createFoodList(resolve, reject);
                //return reject(err);
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

    function createFoodList(resolve, reject) {
        delete params['ConditionExpression'];
        params['UpdateExpression'] = "SET #attrList = :listValue, #attrDate = :dateValue";
        ddb.updateItem(params, function(err, data) {
            if(err) {
                console.log("Error recipe *Second* UPDATE", err);
                return reject(err);
            } else {
                if(data['Attributes'] == null) {
                    reject("error linking the file with recipe in db second try");
                }
                else {
                    console.log("Success recipe Second UPDATE", data);
                    return resolve(data['Attributes']);
                }
            }
        });
    }
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


exports.handler = async (event, context) => {
    try {
        console.log(event);
        // const id = event.id;
        // const fileName = event.fileName;
        // let updatedRecipeItem = await updateItemInRecipes({'id': id, 'fileName': fileName});
        
        //console.log("recipe updated successfully.\n" + JSON.stringify(updatedRecipeItem));
        context.done();
    } catch(err) {
        console.log("error when updating recipe.\n" + err);
        //console.log("deleting file from bucket...");
        //await deleteFromS3(bucket, uploadedName);
        context.done(err);
    }
};