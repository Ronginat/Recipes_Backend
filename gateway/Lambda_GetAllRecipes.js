const AWS = require('aws-sdk');
// Set the region 
AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();

let params = {
    Limit: process.env['LIMIT'],
    TableName: process.env['TABLE'],
    IndexName: process.env['INDEX'],
    KeyConditionExpression: "sharedKey = :v_key AND lastModifiedAt >= :v_time",
    ScanIndexForward: false,
    ReturnConsumedCapacity: "TOTAL"
};

function onQuery(LastEvaluatedKey) {
    if (LastEvaluatedKey != undefined) {
        params.ExclusiveStartKey = LastEvaluatedKey;
    }
    return new Promise((resolve, reject) => {
        docClient.query(params, (err, data) => {
            if (err) {
                console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                // print all the data
                console.log("Scan succeeded. ", JSON.stringify(data));
                resolve(data);
            }
        });
    });
}

async function getAll(date) {
    const ExpressionAttributeValues = {
        ":v_key": process.env['SHARED_KEY'],
        ":v_time": date
    };
    params['ExpressionAttributeValues'] = ExpressionAttributeValues;
    
    let listData = [];
    let LastEvaluatedKey = undefined;

    do {
        const data = await onQuery(LastEvaluatedKey);
        listData = listData.concat(data.Items);
        LastEvaluatedKey = data.LastEvaluatedKey;

    } while(typeof LastEvaluatedKey != "undefined");

    console.log("Scan Success, item count = ", listData.length);
    return listData;
}


// handleHttpRequest is the entry point for Lambda requests
exports.handler = function(request, context, callback) {
    console.log('received event');
    
    let date = "0";
    if(request['pathParameters'] != undefined && request['pathParameters']['bydate'] != undefined) {
        date = request['pathParameters']['bydate'];
    }
    else if(request['queryStringParameters'] != undefined && request['queryStringParameters']['lastModified'] != undefined) {
        date = request['queryStringParameters']['lastModified'];
    }
    
    console.log('requested time: '+ date);

    let response = {
      headers: {
          'Content-Type': 'application/json'
      },
      body: '',
      statusCode: 200
    };

    try {
        const items = await getAll(date);
        response.body = JSON.stringify(items);
        console.error("finish get all recipes");
        callback(null, response);

    } catch(err) {
        console.error("caught exception, " + err);
        response.body = JSON.stringify(err);
        response.statusCode = 500;
        callback(null, response);
    }
    
//     let listData = [];

//     docClient.query(params, onQuery);

//     function onQuery(err, data) {
//       if (err) {
//           console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
//           callback(err);
//       } else {
//           // print all the data
//           console.log("Scan succeeded. ", JSON.stringify(data));
//           listData = listData.concat(data.Items);
  
//           // continue scanning if we have more movies, because
//           // scan can retrieve a maximum of 1MB of data
//           if (typeof data.LastEvaluatedKey != "undefined") {
//               console.log("Scanning for more...");
//               params.ExclusiveStartKey = data.LastEvaluatedKey;
//               docClient.query(params, onQuery);
//           } else {
//             console.log("Scan Success, item count = ", listData.length);
//             response.body = JSON.stringify(listData);
//             callback(err, response);
//           }
//       }
//   }
};