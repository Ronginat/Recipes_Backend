const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
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

function getRecipe(sortKey) {
    const get_params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            "sharedKey": process.env['SHARED_KEY'],
            "lastModifiedDate": sortKey
        }
    };

    return new Promise((resolve, reject) => {
        docClient.get(get_params, (err, data) => {
            if (err) {
                console.error("Couldn't get the recipe. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Get succeeded. ", JSON.stringify(data));
                if(data.Item === undefined)
                    return resolve(null);
                    //return reject("recipe not found");
                return resolve(data.Item);
            }
        });
    });
}

function getQueriedRecipe(recipeId) {
    const get_params = {
        /* Limit: 2, */
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
                console.log("Query succeeded. ", JSON.stringify(data));
                if (data.Items.length > 1) {
                    console.log('Oh no! there are more recipes with ' + recipeId + ' id');
                }
                if(data.Count === 0 || data.Items.length === 0) {
                    return reject("recipe not found");
                }
                return resolve(data.Items[0]);
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
        let files = [];
        for(let i = 0; i < numOfFiles; i++){
            const rand = Math.floor((1 + Math.random()) * 0x100) // add 3 random characters for the case of 2 users requesting urls in the same time
            .toString(16);
            files[i] = process.env['FOLDER'] + "/" + recipe.id + "--food--" + rand + "." + extension;
        }
        return files;
    }
}

function signUrls(fileNames) {
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
    const eventBody = JSON.parse(event['body']);

    try {
        let id = undefined, lastModifiedDate = undefined;
        /* if(event['queryStringParameters'] != undefined && event['queryStringParameters']['id'] != undefined) {
            id = event['queryStringParameters']['id'];
        } */
        if(event['pathParameters'] != undefined && event['pathParameters']['id'] != undefined) {
            id = event['pathParameters']['id'];
            console.log('id = ' + id);
        }
        else {
            throw "request must contain recipe id";
        }
        if(event['queryStringParameters'] != undefined && event['queryStringParameters']['lastModifiedDate'] != undefined) {
            lastModifiedDate = event['queryStringParameters']['lastModifiedDate'];
        }

        if(id !== undefined) {
            const numOfFiles = parseInt(eventBody['numOfFiles'], 10);
        
            let recipeItem = undefined;
            if(lastModifiedDate !== undefined) {
                recipeItem = await getRecipe(lastModifiedDate);
            } 
            if(lastModifiedDate === undefined || recipeItem === undefined || recipeItem === null) {
                recipeItem = await getQueriedRecipe(id);
            }

            if(recipeItem !== undefined && recipeItem !== null) {
                console.log('generating names');
                let fileNames = generateFileNames(numOfFiles, recipeItem, eventBody['extension']);
                console.log("files\n" + fileNames);
                //let pend = await addToPending(eventBody['numOfFiles'], recipeItem, fileNames);
                console.log('signing urls');
                let urls = signUrls(fileNames);

                callback(null, setResponse(200, JSON.stringify(urls)));
            } 
            else
                callback(null, setResponse(400, "recipe not found"));
        }
        //if (Object.keys(pend.UnprocessedItems).length === 0)
        
    } catch(err) {
        console.log(err);
        callback(null, setResponse(500, err));
    }
};