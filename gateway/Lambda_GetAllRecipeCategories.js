// Load the AWS SDK for Node.js
const AWS = require('aws-sdk');
// Set the region 
AWS.config.update({region: process.env['REGION']});

// Create DynamoDB service object
let docClient = new AWS.DynamoDB.DocumentClient();
//let ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});


function setResponse(status, body){
  let response = {
      headers: {
          'Content-Type': 'application/json'},
      body: body,
      statusCode: status
  };
    
  return response;
}

function checkTableTime(){
  const params = {
    TableName: process.env['TABLE'],
    Key: {
      name: "last-modified"
    }
  };
  return new Promise((resolve, reject) => {    
    docClient.get(params, function(err, data){
      if(err){
        console.log("Error", err);
        reject(err);
      }
      else{
        //console.log("Success", data.Item);
        //console.log("up to date? " + result);
        resolve(data.Item['date']);
      }
    });
  });
}

function scanTable(){
  const params = {
     TableName: process.env['TABLE'],
     Limit: process.env['LIMIT'],
  };
    
  let listData = [];

  return new Promise((resolve, reject) => {
    docClient.scan(params, onScan);

    function onScan(err, data) {
      if (err) {
          console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
          reject(err);
      } 
      else {
        console.log("Scan succeeded. ", JSON.stringify(data.Items));
        listData = listData.concat(data.Items);
  
        // scan can retrieve a maximum of 1MB of data
        if (typeof data.LastEvaluatedKey != "undefined") {
            console.log("Scanning for more...");
            params['ExclusiveStartKey'] = data.LastEvaluatedKey;
            docClient.scan(params, onScan);
        } else {
          console.log("Scan Success, item count = ", listData.length);
          resolve(listData);
        }
      }
    }
  });
}

// handleHttpRequest is the entry point for Lambda requests
exports.handler = async function(event, context, callback) {
    console.log('received event\n' + JSON.stringify(event));
    console.log("query string: " + event['queryStringParameters']['lastModified']);
    let lastModified = "0";
    if(event['pathParameters'] != undefined && event['pathParameters']['lastmodified'] != undefined){
      lastModified = event['pathParameters']['lastmodified'];
    }
    else if(event['queryStringParameters'] != undefined && event['queryStringParameters']['lastModified'] != undefined) {
      lastModified = event['queryStringParameters']['lastModified'];
    }

    try {
      console.log('requested time: '+ lastModified);
      if(lastModified !== "0") {
        const lastModifiedTable = await checkTableTime();
        
        console.log("table time " + lastModifiedTable);

        if(lastModified >= lastModifiedTable) {
          callback(null, setResponse(304, "not modified"));
        }
      }

      const scanResults = await scanTable();
      callback(null, setResponse(200, JSON.stringify(scanResults)));
    }
    catch(err) {
      callback(err); 
    }
};