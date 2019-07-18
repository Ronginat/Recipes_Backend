const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

function setResponse(status, body){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
}

function getRecipe(lastModifiedDate) {
    const get_params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['RECIPES_PARTITION'],
            sort: lastModifiedDate // lastModifiedDate
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
                return resolve(data.Item);
            }
        });
    });
}

function getQueriedRecipe(recipeId, lastModifiedDate) {
    const get_params = {
        Limit: 1,
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
                    return reject({
                        statusCode: 404, // Not Found
                        message: "recipe not found"
                    });
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

    const params = {
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

exports.handler = async (event, context, callback) => {
    console.log(JSON.stringify(event));

    try {
        let id = undefined, lastModifiedDate = undefined;

        if(event['pathParameters'] && event['pathParameters']['id']) {
            id = event['pathParameters']['id'];
        } else {
            throw {
                statusCode: 400, // Bad Request
                message: "request must contain recipe id"
            };
        }
        if (!event['queryStringParameters']) {
            throw {
                statusCode: 400, // Bad Request
                message: "missing numOfFiles and extension query params"
            };
        }

        const { queryStringParameters: queryParams } = event; // event object destructuring
        
        if (queryParams['lastModifiedDate']) {
            lastModifiedDate = queryParams['lastModifiedDate'];
        }
        if (!queryParams['numOfFiles'] || !queryParams['extension']) {
            throw {
                statusCode: 400, // Bad Request
                message: "numOfFiles and extension query params required"
            };
        }
        
        const numOfFiles = parseInt(queryParams['numOfFiles'], 10);
    
        let recipeItem = undefined;
        if(lastModifiedDate) {
            recipeItem = await getRecipe(lastModifiedDate);
        } 
        if(!recipeItem) {
            recipeItem = await getQueriedRecipe(id, lastModifiedDate);
        }

        if(recipeItem) {
            console.log('generating names');
            let fileNames = generateFileNames(numOfFiles, recipeItem, queryParams['extension']);
            console.log("files\n" + fileNames);
            //let pend = await addToPending(eventBody['numOfFiles'], recipeItem, fileNames);
            console.log('signing urls');
            const urls = signUrls(fileNames);

            callback(null, setResponse(200, JSON.stringify(urls)));
        } 
        else
            throw {
                statusCode: 404,
                message: "recipe not found!"
            };
        
        //if (Object.keys(pend.UnprocessedItems).length === 0)
        
    } catch(err) {
        console.log(JSON.stringify(err));
        //callback(null, setResponse(500, err));
        const { statusCode, message } = err;
        if (message !== undefined && statusCode !== undefined) {
            callback(null, setResponse(statusCode, JSON.stringify(message)));
        } else {
            callback(null, setResponse(500, JSON.stringify(err)));
        }
    }
};