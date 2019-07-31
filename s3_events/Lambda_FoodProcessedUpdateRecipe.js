const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();

function dateToString() {
    return new Date().toISOString();
}

function getQueriedRecipe(recipeId, lastModifiedDate) {
    const params = {
        Limit: 20,
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "partitionKey = :v_key AND #sort >= :v_date",
        FilterExpression: "#id = :v_id",
        ExpressionAttributeNames: {
          "#id":  "id",
          "#sort": "sort"
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['RECIPES_PARTITION'],
            ":v_id": recipeId,
            ":v_date": lastModifiedDate
        },
        ScanIndexForward: false, // read latest first, possible better performance
        // in case the deleteOldRecipe didn't work, the recipe probably changed very recently
        ReturnConsumedCapacity: "TOTAL"
    };

    return new Promise((resolve, reject) => {
        docClient.query(params, (err, data) => {
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
                return resolve(data.Items[0].sort);
            }
        });
    });
}

function deleteOldRecipe(id, lastModifiedDate) {
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
}

async function retrieveDeletedRecipe(id, lastModifiedDate) {
    let oldRecipe;
    try {
        oldRecipe = await deleteOldRecipe(id, lastModifiedDate);
    } catch (err) {
        try {
            const updatedLastModifiedDate = await getQueriedRecipe(id, lastModifiedDate);
            oldRecipe = await deleteOldRecipe(id, updatedLastModifiedDate);
        } catch (err2) {
            console.log(JSON.stringify(err2));
        }
    }
    return oldRecipe;
}

async function patchRecipe(id, lastModifiedDate, fileName, isThumbnail = false) {
    const date = dateToString();

    let oldRecipe = await retrieveDeletedRecipe(id, lastModifiedDate);
    if (!oldRecipe) {
        throw "recipe not found!";
    }

    if (!isThumbnail) { // add file to images list (or create a new list)
        // currently never invoked with isThumbnail = false
        // because it's taking too long to invoke the lambda and procces the file (more than 1 second)
        // when uploading multiple images, the recipe record won't update fast enough and ThumbnailGenerator will be invoked
        if(!oldRecipe.hasOwnProperty('images')) {
            oldRecipe['images'] = [fileName];
        } else {
            oldRecipe.images.push(fileName);
        }
    } else { // add thumbnail to the recipe
        oldRecipe.thumbnail = fileName;
    }

    oldRecipe.sort = date;
    oldRecipe.lastModifiedDate = date;

    const putRecipeParams = {
        TableName: process.env['RECIPE_TABLE'],
        Item: oldRecipe,
        ReturnConsumedCapacity: "TOTAL"
        /* ReturnValues: 'ALL_OLD' */
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(putRecipeParams, function(err, data) {
            if (err) {
                console.log("Error recipe PUT", JSON.stringify(err));
                return reject(err);
            } 
            else {
                console.log("Success recipe PUT", data);
                return resolve(data.Attributes);
            }
        });
    });
}


exports.handler = async (event) => {
    console.log(JSON.stringify(event));
    try {
        const { id, fileName, lastModifiedDate, thumbnail} = event;
        const updatedRecipeItem = await patchRecipe(id, lastModifiedDate, fileName, thumbnail);
        //let updatedRecipeItem = await updateItemInRecipes({'id': id, 'fileName': fileName});
        
        console.log("recipe updated successfully.\n" + JSON.stringify(updatedRecipeItem));
        return;
    } catch(err) {
        console.log(JSON.stringify(err));
        return err;
    }
};