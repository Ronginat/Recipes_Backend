const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const s3 = new AWS.S3();

function setResponse(status, body){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
      
    return response;
}

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

function getItemFromRecipes(itemId) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            id: itemId,
            sharedKey: process.env['SHARED_KEY']
        }
        
    };
    //"sharedKey": process.env['SHARED_KEY']
    // ProjectionExpression: "id, #recipeName, foodFiles",
    //     ExpressionAttributeNames: {
    //         '#recipeName': 'name'
    //     }
    //delete params['ProjectionExpression'];
    //delete params['ExpressionAttributeNames'];

    return new Promise((resolve, reject) => {
        // Call DynamoDB to read the item from the table
        docClient.get(params, function(err, data) {
            if (err) {
                console.log("Error recipe GET", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe GET", data);
                return resolve(data.Item);
            }
        });
    });
}

function addToPending(recipe, fileNames) {
    const date = dateToString();
    const Table = process.env['PEND_IMG_TABLE'];
    
    let i = 0, filesArray = [];
    for(i = 0; i < fileNames.length; i++) {
        filesArray.push({
            PutRequest: {
                Item: {
                    "fileName": {"S": fileNames[i]},
                    "createdAt": {"S": date},
                    "id" : {"S": recipe.id}
                }
            }
        });
    }
    //params.RequestItems[Table] = filesArray;
    const params = {
        RequestItems: {
            Table: filesArray
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        ddb.batchWriteItem(params, function(err, data) {
            if (err) {
                console.log("Error pend batch PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success pend batch PUT", data);
                // data['UnproccessedItems'].forEach(element => {
                //     results.push(element['PutRequest']['fileName']);
                // });
                return resolve(data);
            }
        });
    });
}

function generateFileNames(numOfFiles, recipe, extension) {
    let allowedExtenstions = ["jpg", "jpeg", "png"];
    if(!allowedExtenstions.includes(extension)) {
        throw "extention not supported";
    }
    else if(numOfFiles > process.env['MAX_FILES_PER_UPLOAD']) {
        throw "too many files!";
    }
    else {
        let length = 0;
        if(recipe['foodFiles'] != undefined) {
            length = recipe['foodFiles'].length;
        }
        let i;//, prefix = process.env['FOLDER'] + "/" + recipe.id;
        let files = [];
        for(i = length; i < numOfFiles + length; i++){
            const rand = Math.floor((1 + Math.random()) * 0x100) // add 3 random characters for the case of 2 users requesting urls in the same time
            .toString(16);
            files[i - length] = process.env['FOLDER'] + "/" + recipe.id + "--food--" + rand + "." + extension;
        }
        console.log("files\n" + files);
        return files;
    }
}

function signUrls(fileNames) {
    console.log('start sign urls');
    console.log(fileNames);
    const myBucket = process.env['BUCKET'];
    const signedUrlExpireSeconds = 60 * 5; //5 minutes
    let i = 0;

    let params = {
        Bucket: myBucket,
        'Key': fileNames[i],
        Expires: signedUrlExpireSeconds
    };

    let urls = [];
    for(i = 0; i < fileNames.length; i++) {
        params['Key'] = fileNames[i];
        urls[i] = s3.getSignedUrl('putObject', params);
    }

    return urls;
}

exports.handler = async function(event, context, callback) {
    console.log(event);
    let eventBody = JSON.parse(event['body']);

    try {
        let results = {}, id;
        if(event['queryStringParameters'] != undefined && event['queryStringParameters']['id'] != undefined) {
            id = event['queryStringParameters']['id'];
        }
        else {
            throw "request must contain recipe id";
        }

        const numOfFiles = parseInt(eventBody['numOfFiles']);
        console.log('id = ' + id);
        //let username = await getUsername(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
        let recipeItem = await getItemFromRecipes(id);
        console.log('generating names');
        let fileNames = generateFileNames(numOfFiles, recipeItem, eventBody['extension']);
        //let pend = await addToPending(eventBody['numOfFiles'], recipeItem, fileNames);
        console.log('signing urls');
        let urls = signUrls(fileNames);

        //if (Object.keys(pend.UnprocessedItems).length === 0)

        //results['Item'] = recipeItem;
        //results['fileNames'] = fileNames;
        //results['urls'] = urls;
        
        callback(null, setResponse(200, JSON.stringify(urls)));

    } catch(err) {
        console.log(err);
        callback(null, setResponse(400, err));
    }
};