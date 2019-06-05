const AWS = require('aws-sdk');
// Set the region 
AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();

const params = {
    Limit: process.env['LIMIT'],
    TableName: process.env['TABLE'],
    KeyConditionExpression: "sharedKey = :v_key AND #modified >= :v_time",
    ProjectionExpression: "#id, #name, #desc, #created, #modified, #uploader, #thumbnail, #images, #categories, #likes, #deleted",
    ExpressionAttributeNames: {
      "#id":  "id",
      "#name": "name",
      "#desc": "description",
      "#created": "creationDate",
      "#modified": "lastModifiedDate",
      "#uploader": "uploader",
      "#thumbnail": "thumbnail",
      "#images": "foodFiles",
      "#categories": "categories",
      "#likes": "likes",
      "#deleted": "isDeleted"
    },
    ScanIndexForward: false,
    ReturnConsumedCapacity: "TOTAL"
};

function onQuery(LastEvaluatedKey) {
    if (LastEvaluatedKey != undefined) {
        params['ExclusiveStartKey'] = LastEvaluatedKey;
    }
    return new Promise((resolve, reject) => {
        docClient.query(params, (err, data) => {
            if (err) {
                console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Scan succeeded. ", JSON.stringify(data));
                return resolve(data);
            }
        });
    });
}

async function getAll(date, ExclusiveStartKey, userLimit) {
    const ExpressionAttributeValues = {
        ":v_key": process.env['SHARED_KEY'],
        ":v_time": date
    };
    params['ExpressionAttributeValues'] = ExpressionAttributeValues;
    const absoluteLimit  = Math.min(process.env['LIMIT'], userLimit);
    params['Limit'] = absoluteLimit;
    
    let listData = [];
    let LastEvaluatedKey = ExclusiveStartKey;
    
    do {
        const data = await onQuery(LastEvaluatedKey);
        listData = listData.concat(data.Items);
        LastEvaluatedKey = data.LastEvaluatedKey;
        console.log('in get all, last key ' + LastEvaluatedKey);

    } while(typeof LastEvaluatedKey != "undefined" && listData.length < absoluteLimit);

    console.log("Scan Success, item count = ", listData.length + ", last key = " + JSON.stringify(LastEvaluatedKey));
    return {
        "LastEvaluatedKey": LastEvaluatedKey, 
        "listData": listData
    };
}


// handleHttpRequest is the entry point for Lambda requests
exports.handler = async (request, context, callback) => {
    console.log('received event');
    
    let date = "0", startKey = undefined, userLimit = process.env['LIMIT'];
    /*if(request['pathParameters'] != undefined && request['pathParameters']['bydate'] != undefined) {
        date = request['pathParameters']['bydate'];
    }
    else */if(request['queryStringParameters'] !== undefined && request['queryStringParameters']['lastModified'] !== undefined) {
        date = request['queryStringParameters']['lastModified'];
    }
    if(request['queryStringParameters'] !== undefined && request['queryStringParameters']['Last-Evaluated-Key'] !== undefined) {
        startKey = request['queryStringParameters']['Last-Evaluated-Key'];
        startKey = JSON.parse(startKey);
    }
    if(request['queryStringParameters'] !== undefined && request['queryStringParameters']['limit'] !== undefined) {
        userLimit = request['queryStringParameters']['limit'];
    }
    
    console.log('requested time: '+ date);
    console.log('requested limit: '+ userLimit);
    console.log('requested start key: '+ startKey);

    const response = {
      headers: {
          'Content-Type': 'application/json',
          'Last-Evaluated-Key': '',
      },
      body: '',
      statusCode: 200
    };
    
    try {
        //let items = undefined;
        const { LastEvaluatedKey, items } = await getAll(date, startKey, userLimit);
        if (startKey !== undefined && (items === undefined || items.length == 0)) {
            response.statusCode = 304;
        }
        if (LastEvaluatedKey != undefined) {
            response['headers']['Last-Evaluated-Key'] = JSON.stringify(LastEvaluatedKey);
        }
        
        response.body = JSON.stringify(items);
        console.log("finish get all recipes");
        callback(null, response);

    } catch(err) {
        console.error("caught exception, " + err);
        response.body = JSON.stringify({"message": err});
        response.statusCode = 500;
        callback(null, response);
    }
};