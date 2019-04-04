const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
//const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});


function dateToString() {
    return new Date().toISOString();
}

function decodeID(name) {
    /* const dot = name.lastIndexOf(".");
    let temp = name.substring(0, dot);
    return temp.split("---")[1]; */
    return name.split("/")[1].split("--recipe--")[0];
}

function putItemInRecipes(pendItem) {
    const date = dateToString();

    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'id' : pendItem.id,
            'sharedKey': process.env['SHARED_KEY'],
            'name' : pendItem.name,
            'description': pendItem.description,
            'uploader': pendItem.uploader,
            'categories': pendItem.categories,
            'recipeFile': pendItem.recipeFile,
            'creationDate': pendItem.creationDate,
            'lastModifiedDate': date,
            'likes': 0,
            'isDeleted': false
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
                return resolve(data.Item);
            }
        });
    });
}

function removeFromPending(key) {
    let params = {
        TableName: process.env['PEND_RECIPE_TABLE'],
        Key: {
            'id': key
        },
        ReturnValues: 'ALL_OLD'
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

function invokePublishLambda(payload) {
    const params = {
        FunctionName: process.env['SNS_PUBLISH_LAMBDA'],
        InvocationType: 'Event',
        LogType: 'Tail',
        Payload: JSON.stringify(payload)
    };

    return new Promise((resolve, reject) => {
        lambda.invoke(params, (err,data) => {
            if (err) { 
                console.log(err, err.stack);
                reject(err);
            }
            else {
                console.log(data);
                return resolve(data);
            }
        });
    });
}

exports.handler = async function(event, context) {
    let record = event['Records'][0]['s3'];
    let uploadedName = record['object']['key'];
    let bucket = record['bucket']['name'];

    let posted = false;

    const id = decodeID(uploadedName);
    try {
        let removedPend = await removeFromPending(id);
        let postedRecipeItem = await putItemInRecipes(removedPend);
        postsed = true;
        await invokePublishLambda({
            "message": "click to view the recipe",
            "title": removedPend.name + ", by " + removedPend.uploader,
            "topic": process.env['NEW_RECIPE_TOPIC'],
            "id": removedPend.id,
            "channel": "newRecipes",
            "messageAttributes": {
                "categories" : {
                    "DataType": "String.Array",
                    "StringValue": JSON.stringify(removedPend.categories)
                }
            }
        });
        //let removedImages = await deletePendingImagesFromS3(removedPend['pendImages']);
        
        console.log("recipe upload successfully.\n" + JSON.stringify(postedRecipeItem));

    } catch(err) {
        console.log("error when uploading recipe.\n" + err);
        if(!posted) {
            console.log("deleting file from bucket...");
            await deleteFromS3(bucket, uploadedName);
        }
    }
};