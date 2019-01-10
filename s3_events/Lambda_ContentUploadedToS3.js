const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
//const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
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
    const millis = date.getUTCMilliseconds();

    return '' + year + '-' + (month <= 9 ? '0' + month : month) + '-' + (day <= 9 ? '0' + day : day)
            + ' ' + (hours <= 9 ? '0' + hours : hours) + ':' + (minutes <= 9 ? '0' + minutes : minutes)
            + ':' + (seconds <= 9 ? '0' + seconds : seconds)
            + '.' + (millis <= 10 ? '00' + millis : ( millis <= 100 ? '0' + millis : millis) );
}

function getIdFromFileName(name) {
    const dot = name.lastIndexOf(".");
    let temp = name.substring(0, dot);
    return temp.split("---")[1];
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

// function deletePendingImagesFromS3(images) {
//     let array = [];
//     let params = {
//         Bucket: process.env['BUCKET'],
//         Delete: {
//             Quiet: false,
//         },
//     };
//     images.forEach(function(element, index, arr) {
//         array.push({
//             Key: element
//         });
//     });
//     params.Delete['Objects'] = array;

//     return new Promise((resolve, reject) => {
//         // Call DynamoDB to add the item to the table
//         s3.deleteObjects(params, function(err, data) {
//             if (err) {
//                 console.log(err, err.stack); // an error occurred
//                 reject(err);
//             }
//             else {
//                 console.log(data); // successful response
//                 resolve(data);
//             }
//         });
//     });
// }

exports.handler = async function(event, context) {
    let record = event['Records'][0]['s3'];
    let uploadedName = record['object']['key'];
    let bucket = record['bucket']['name'];

    const id = getIdFromFileName(uploadedName);
    try {
        let removedPend = await removeFromPending(id);
        let postedRecipeItem = await putItemInRecipes(removedPend);
        //let removedImages = await deletePendingImagesFromS3(removedPend['pendImages']);
        
        console.log("recipe upload successfully.\n" + JSON.stringify(postedRecipeItem));

    } catch(err) {
        console.log("error when uploading recipe.\n" + err);
        console.log("deleting file from bucket...");
        await deleteFromS3(bucket, uploadedName);
    }
};