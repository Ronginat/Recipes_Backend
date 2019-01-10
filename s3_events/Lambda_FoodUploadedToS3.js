const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
AWS.config.update({region: process.env['REGION']});

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

function getRecipe(recipeId) {
    const get_params = {
        Limit: 2,
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "sharedKey = :v_key",
        FilterExpression: "#id = :v_id",
        ExpressionAttributeNames: {
          "#id":  "id",
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['SHARED_KEY'],
            ":v_id": recipeId
        },
        ReturnConsumedCapacity: "TOTAL"
    };

    return new Promise((resolve, reject) => {
        docClient.query(get_params, (err, data) => {
            if (err) {
                console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Scan succeeded. ", JSON.stringify(data));
                console.log("Scan Success, item count = ", data.Items.length + ", last key = " + JSON.stringify(data.LastEvaluatedKey));
                if (data.Items.length > 1) {
                    console.log('Oh no! there are more recipes with ' + recipeId + ' id');
                }
                if(data.Count == 0){
                    reject("recipe not found");
                }
                return resolve(data.Items[0]);
            }
        });
    });
}


// function removeFromPending(key) {
//     let params = {
//         "TableName": process.env['PEND_IMG_TABLE'],
//         "Key": {
//             "fileName": key
//         },
//         "ReturnValues": "ALL_OLD"
//     };

//     return new Promise((resolve, reject) => {
//         // Call DynamoDB to add the item to the table
//         docClient.delete(params, function(err, data) {
//             if (err) {
//                 console.log("Error pend DELETE", err);
//                 return reject(err);
//             } 
//             else {
//                 if(data['Attributes'] == null) {
//                     reject("uploaded file not found in pending table");
//                 }
//                 else {
//                     console.log("Success pend DELETE", data);
//                     return resolve(data['Attributes']);
//                 }
//             }
//         });
//     });
// }

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

function invokeFoodProcessedUpdateRecipe(payload) {
    const params = {
        FunctionName: process.env['UPDATE_RECIPE_LAMBDA'],
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

function invokeThumbnailGenerator(payload) {
    const params = {
        FunctionName: 'ThumbnailGenerator',
        InvocationType: 'Event',
        /* LogType: 'Tail', */
        Payload: JSON.stringify(payload)
    };

    return new Promise((resolve, reject) => {
        lambda.invoke(params, (err,data) => {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            }
            else if ('FunctionError' in data) {
                console.log(data);
                reject(JSON.parse(data.Payload).errorMessage);
            }
            else {
                console.log(data);
                resolve(data);
            }
        });
    });

    // lambda.invoke(params, (err,data) => {
    //     if (err) console.log(err, err.stack);
    //     else console.log(data);
    // });
}

function decodeID(name) {
    const dirName = process.env['FOLDER'];
    const dirLength = dirName.length;
    return name.substring(dirLength + 1, dirLength + 1 + 12);
}

function decodeFileName(name) {
    const dirName = process.env['FOLDER'];
    const dirLength = dirName.length;
    return name.substring(dirLength + 1);
}


exports.handler = async function(event, context) {
    let record = event['Records'][0]['s3'];
    let uploadedName = record['object']['key'];
    let bucket = record['bucket']['name'];

    console.log(record);
    try {
        //let removedPend = await removeFromPending(uploadedName);
        const id = decodeID(uploadedName);
        const fileName = decodeFileName(uploadedName);
        const recipe = await getRecipe(id);

        const updateRecipePayload = {
            'id': id,
            'lastModifiedDate': recipe.lastModifiedDate,
            'fileName': fileName,
        };

        if (!recipe.hasOwnProperty('foodFiles')) { // if (!('foodFiles' in recipe))
            const payload = {
                'bucket': bucket,
                'filePath': uploadedName,
                'fileName': fileName,
                'targetDir': 'thumbnails',
                'invokeOnComplete': process.env['UPDATE_RECIPE_LAMBDA'],
                'invokeOnComletePayload': updateRecipePayload
            };
            await invokeThumbnailGenerator(payload);
            console.log("finish thumbnail lambda");
        } else {
            /* const payload = {
                'id': id,
                'lastModifiedDate': recipe.lastModifiedDate,
                'fileName': fileName,
            }; */
            await invokeFoodProcessedUpdateRecipe(updateRecipePayload);
        }
        
        console.log("exit food uploaded lambda");

        //let updatedRecipeItem = await updateItemInRecipes({'id': id, 'fileName': fileName});

        //console.log("recipe upload successfully.\n" + JSON.stringify(updatedRecipeItem));

    } catch(err) {
        console.log("error when uploading recipe.\n" + err);
        console.log("deleting file from bucket...");
        await deleteFromS3(bucket, uploadedName);
    }
};