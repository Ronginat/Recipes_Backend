const AWS = require('aws-sdk');

/**
 * Unused Lambda
 */

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
    const params = {
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

function invokePublishLambda(recipe) {
    const payload = {
        "message": "click to view the recipe",
        "title": recipe.name + ", by " + recipe.uploader,
        "topic": process.env['NEW_RECIPE_TOPIC'],
        "id": recipe.id,
        "channel": "newRecipes",
        "messageAttributes": {
            "categories" : {
                "DataType": "String.Array",
                "StringValue": JSON.stringify(recipe.categories)
            }
        }
    };
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

//#region Update User Details

function updateUserPostedRecipes(username, recipeId) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            hash: process.env['APP_NAME'], //Recipes
            username: username
        },
        ConditionExpression: "attribute_exists(posted)",
        UpdateExpression: "SET posted = list_append(posted, :postValue)",
        ExpressionAttributeValues: {
            ":postValue": [recipeId]
        },
        ReturnValues: "NONE"
    };

    return new Promise((resolve, reject) => {
        docClient.update(params, (err, data) => {
            if(err) {
                console.log("Error user UPDATE", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Success user UPDATE", JSON.stringify(data));
                resolve(data.Attributes);
            }
        });
    });
}

//#endregion Update User Details

exports.handler = async function(event, context, callback) {
    const record = event['Records'][0]['s3'];
    const uploadedName = record['object']['key'];
    const bucket = record['bucket']['name'];

    let posted = false;

    const id = decodeID(uploadedName);
    try {
        const removedPend = await removeFromPending(id);
        const postedRecipeItem = await putItemInRecipes(removedPend);
        posted = true;
        
        await Promise.all([
            invokePublishLambda(removedPend),
            updateUserPostedRecipes(removedPend.uploader, removedPend.id)
        ]);

        //await invokePublishLambda(removedPend);
        //await updateUserPostedRecipes(removedPend.uploader, removedPend.id);
        
        console.log("recipe upload successfully.\n" + JSON.stringify(postedRecipeItem));
        callback(null);

    } catch(err) {
        console.log("error when uploading recipe.\n" + err);
        if(!posted) {
            console.log("deleting file from bucket...");
            await deleteFromS3(bucket, uploadedName);
        }
    }
};