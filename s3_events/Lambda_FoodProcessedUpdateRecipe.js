const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();

function dateToString() {
    return new Date().toISOString();
}

function deleteOldRecipe(lastModifiedDate, id) {
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
                console.log("Error recipe DELETE", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe DELETE", data);
                return resolve(data.Attributes);
            }
        });
    });
}

async function patchRecipe(lastModifiedDate, id, fileName, isThumbnail = false) {
    const date = dateToString();

    let oldRecipe = await deleteOldRecipe(lastModifiedDate, id);

    if(!oldRecipe.hasOwnProperty('foodFiles')) {
        oldRecipe['foodFiles'] = [fileName];
    } else {
        oldRecipe.foodFiles.push(fileName);
    }

    if(isThumbnail !== false)
        oldRecipe.thumbnail = fileName;
    oldRecipe.sort = date;
    oldRecipe.lastModifiedDate = date;

    const putRecipeParams = {
        TableName: process.env['RECIPE_TABLE'],
        Item: oldRecipe,
        ReturnValues: 'ALL_OLD'
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(putRecipeParams, function(err, data) {
            if (err) {
                console.log("Error recipe PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe PUT", data);
                return resolve(data['Attributes']);
            }
        });
    });
}


exports.handler = async (event) => {
    try {
        console.log(event);
        const { id, fileName, lastModifiedDate, isThumbnail} = event;
        const updatedRecipeItem = await patchRecipe(lastModifiedDate, id, fileName, isThumbnail);
        //let updatedRecipeItem = await updateItemInRecipes({'id': id, 'fileName': fileName});
        
        console.log("recipe updated successfully.\n" + JSON.stringify(updatedRecipeItem));
        return;
    } catch(err) {
        console.log("error when updating recipe.\n" + err);
        return err;
    }
};