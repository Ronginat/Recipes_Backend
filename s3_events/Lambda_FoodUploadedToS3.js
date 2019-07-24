const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();
AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

function dateToString() {
    return new Date().toISOString();
}

function getQueriedRecipe(recipeId) {
    const quey_params = {
        Limit: 1,
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "partitionKey = :v_key",
        FilterExpression: "#id = :v_id",
        ExpressionAttributeNames: {
          "#id":  "id",
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['RECIPES_PARTITION'],
            ":v_id": recipeId
        },
        ScanIndexForward: false, // read latest first, possible better performance
        ReturnConsumedCapacity: "TOTAL"
    };

    return new Promise((resolve, reject) => {
        docClient.query(quey_params, (err, data) => {
            if (err) {
                console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Query succeeded. ", JSON.stringify(data));
                if (data.Items.length > 1) {
                    console.log('Oh no! there are more than one recipe with ' + recipeId + ' id', 'taking the first one, ' + data.Items[0].name);
                }
                if(data.Count === 0 || data.Items.length === 0) {
                    return reject("recipe not found");
                }
                return resolve(data.Items[0]);
            }
        });
    });
}

/* function deleteOldRecipe(lastModifiedDate, id) {
    const deleteParams = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['RECIPES_PARTITION'], //recipe
            sort: lastModifiedDate
        },
        ConditionExpression: "#id = :v_id",
        ExpressionAttributeNames: {
            "#id": "id"
        },
        ExpressionAttributeValues: {
            ":v_id": id
        },
        ReturnValues: "ALL_OLD"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.delete(deleteParams, function(err, data) {
            if (err) {
                console.log("Error recipe DELETE", JSON.stringify(err));
                return reject(err);
            } 
            else {
                console.log("Success recipe DELETE", JSON.stringify(data));
                return resolve(data.Attributes);
            }
        });
    });
} */

/**
 * Sets images list without changing sort (lastModifiedDate) attribute.
 * @param {string} fileName Add to images new list (using DynamoDB SET )
 */
function updateRecipe(lastModifiedDate, id, fileName) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['RECIPES_PARTITION'],
            sort: lastModifiedDate
        },
        UpdateExpression: "SET #images = :v_list",
        ConditionExpression: "#id = :v_id",
        ExpressionAttributeNames: {
            "#images": "images",
            "#id": "id"
        },
        ExpressionAttributeValues: {
            ":v_list": [fileName],
            ":v_id": id
        },
        ReturnValues: "ALL_NEW",
        ReturnConsumedCapacity: "TOTAL"
    };

    return docClient.update(params).promise();
}

/**
 * Add fileName to oldRecipe's images list
 * @param {any} oldRecipe 
 * @param {string} fileName 
 */
async function patchRecipe(oldRecipe, fileName) {
    const date = dateToString();

    // add file to images list (or create a new list)
    if(!oldRecipe.hasOwnProperty('images')) {
        // don't change the recipe's date, it'll be updated when the thumbnail is ready
        return await updateRecipe(oldRecipe.sort, oldRecipe.id, fileName);
    } else {
        // no thumbnail will be created, so update the recipe's date now
        const newRecipe = { ...oldRecipe };
        newRecipe.images.push(fileName);
        newRecipe.sort = date;
        newRecipe.lastModifiedDate = date;

        const putRecipeParams = {
            RequestItems: {
                recipes: [
                    {
                        DeleteRequest: {
                            Key: {
                                partitionKey: process.env['RECIPES_PARTITION'], //recipe
                                sort: oldRecipe.sort
                            },
                            ConditionExpression: "#id = :v_id",
                            ExpressionAttributeNames: {
                                "#id": "id"
                            },
                            ExpressionAttributeValues: {
                                ":v_id": oldRecipe.id
                            },
                        }
                    },
                    {
                        PutRequest: {
                            Item: newRecipe
                        }
                    }
                ]
            },
            ReturnConsumedCapacity: 'TOTAL'
        };

        return await docClient.batchWrite(putRecipeParams).promise();
    }
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

/* function invokeFoodProcessedUpdateRecipe(payload) {
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
                return reject(err);
            }
            else {
                console.log(data);
                return resolve(data);
            }
        });
    });
    
} */

function invokeThumbnailGenerator(payload) {
    const params = {
        FunctionName: process.env['THUMBNAIL_GENERATOR_LAMBDA'],
        InvocationType: 'Event',
        /* LogType: 'Tail', */
        Payload: JSON.stringify(payload)
    };

    return new Promise((resolve, reject) => {
        lambda.invoke(params, (err, data) => {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            }
            else if ('FunctionError' in data) {
                console.log(JSON.stringify(data));
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
    return name.split("/")[1].split("--food--")[0];
}

function decodeFileName(name) {
    return name.split("/")[1];
}


exports.handler = async (event) => {
    const record = event['Records'][0]['s3'];
    const uploadedName = record['object']['key'];
    const bucket = record['bucket']['name'];

    console.log(JSON.stringify(record));
    try {
        const id = decodeID(uploadedName);
        const fileName = decodeFileName(uploadedName);
        const recipe = await getQueriedRecipe(id);

        if (!recipe) {
            throw "recipe not found!";
        }

        const updateRecipePayload = {
            'id': id,
            'lastModifiedDate': recipe.lastModifiedDate,
            'fileName': fileName,
        };

        // call next lambda to insert the image to images list
        //await invokeFoodProcessedUpdateRecipe(updateRecipePayload);

        // patch the recipe
        const output = await patchRecipe(recipe, fileName);
        console.log('patch output', JSON.stringify(output));

        if (!recipe.hasOwnProperty('images')) { // if (!('images' in recipe))
            const generatorOnCompletePayload = { ...updateRecipePayload };
            generatorOnCompletePayload['thumbnail'] = true;
            const thumbnailGeneratorPayload = {
                'bucket': bucket,
                'filePath': uploadedName,
                'fileName': fileName,
                'targetDir': 'thumbnails',
                'invokeOnComplete': process.env['UPDATE_RECIPE_LAMBDA'],
                'invokeOnCompletePayload': generatorOnCompletePayload
            };
            await invokeThumbnailGenerator(thumbnailGeneratorPayload);
            console.log("thumbnail lambda invoked");
        }        
        
        console.log("exit food uploaded lambda");

    } catch(err) {
        console.log('error', JSON.stringify(err));
        console.log("deleting file from bucket...");
        await deleteFromS3(bucket, uploadedName);
    }
};