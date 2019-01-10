const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();

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


function deleteOldRecipe(partition, sort, id) {
    const deleteParams = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            sharedKey: partition,
            lastModifiedDate: sort
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

async function patchRecipe(lastModifiedDate, id, fileName) {
    const date = dateToString();

    let oldRecipe = await deleteOldRecipe(process.env['SHARED_KEY'], lastModifiedDate, id);

    if(!oldRecipe.hasOwnProperty('foodFiles')) {
        oldRecipe['foodFiles'] = [fileName];
    } else {
        oldRecipe.foodFiles.push(fileName);
    }

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


exports.handler = async (event, context) => {
    try {
        console.log(event);
        const id = event.id;
        const fileName = event.fileName;
        const lastModifiedDate = event.lastModifiedDate;
        const updatedRecipeItem = await patchRecipe(lastModifiedDate, id, fileName);
        //let updatedRecipeItem = await updateItemInRecipes({'id': id, 'fileName': fileName});
        
        console.log("recipe updated successfully.\n" + JSON.stringify(updatedRecipeItem));
        context.done();
    } catch(err) {
        console.log("error when updating recipe.\n" + err);
        //console.log("deleting file from bucket...");
        //await deleteFromS3(bucket, uploadedName);
        context.done(err);
    }
};