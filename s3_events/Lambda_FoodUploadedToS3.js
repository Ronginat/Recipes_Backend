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


function getRecipe(key) {
    let params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            id: key,
            sharedKey: process.env['SHARED_KEY']
        },
    };
    
    /*"ProjectionExpression": "id, #recipeName, comments",
        "ExpressionAttributeNames": {
            "#recipeName": "name"
        }*/

    return new Promise((resolve, reject) => {
        docClient.get(params, (err, data) => {
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
                    return resolve(data['Item']);
                }
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
        FunctionName: 'FoodProcessedUpdateRecipe',
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
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
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
        if (!recipe.hasOwnProperty('foodFiles')) { // if (!('foodFiles' in recipe))
            const payload = {
                'filePath': uploadedName,
                'fileName': fileName,
                'targetDir': 'thumbnails'
            };
            await invokeThumbnailGenerator(payload);
            console.log("finish thumbnail lambda");
        }

        const payload = {
            'id': id,
            'fileName': fileName,
        };
        await invokeFoodProcessedUpdateRecipe(payload);        
        console.log("exit food uploaded lambda");

        //let updatedRecipeItem = await updateItemInRecipes({'id': id, 'fileName': fileName});

        //console.log("recipe upload successfully.\n" + JSON.stringify(updatedRecipeItem));

    } catch(err) {
        console.log("error when uploading recipe.\n" + err);
        console.log("deleting file from bucket...");
        await deleteFromS3(bucket, uploadedName);
    }
};