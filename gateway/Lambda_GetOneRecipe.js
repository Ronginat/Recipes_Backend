const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();

function setResponse(status, body){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
}

function getRecipe(sortKey) {
    const get_params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['RECIPES_PARTITION'],
            sort: sortKey // lastModifiedDate
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
        // in case the getRecipe didn't work, the recipe probably changed very recently
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
                if(/* data.Count === 0 ||  */data.Items.length === 0) {
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


exports.handler = async (event, context, callback) => {
    let id = undefined, lastModifiedDate = undefined;
    //console.log(JSON.stringify(event.body));

    try {
        if (event['pathParameters'] && event['pathParameters']['id']) {
            id = event['pathParameters']['id'];
        } else {
            throw {
                statusCode: 400, // Bad Request
                message: "request must contain recipe id"
            };
        }
        if (event['queryStringParameters'] && event['queryStringParameters']['lastModifiedDate']) {
            lastModifiedDate = event['queryStringParameters']['lastModifiedDate'];
        }
        
        let recipe = undefined;
        if (lastModifiedDate) {
            // get by sort key
            recipe = await getRecipe(lastModifiedDate);
        } 
        if (!recipe) {
            // getRecipe didn't find the recipe by sort key
            // query table by id
            recipe = await getQueriedRecipe(id, lastModifiedDate ? lastModifiedDate : "0");
        }
        
        callback(null, setResponse(200 , JSON.stringify(recipe)));
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        const { statusCode, message } = err;
        if (message !== undefined && statusCode !== undefined) {
            callback(null, setResponse(statusCode, JSON.stringify(message)));
        } else {
            callback(null, setResponse(500, JSON.stringify(err)));
        }
    }
};