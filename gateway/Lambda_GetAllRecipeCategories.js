// Load the AWS SDK for Node.js
const AWS = require('aws-sdk');
// Set the region 
AWS.config.update({region: process.env['REGION']});

// Create DynamoDB service object
const docClient = new AWS.DynamoDB.DocumentClient();
//let ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});

const lastModifiedKey = "lastModifiedDate";


function setResponse(status, body){
  return {
      headers: {
          'Content-Type': 'application/json'},
      body: body,
      statusCode: status
  };
}

function checkTableTime(){
  const params = {
    TableName: process.env['TABLE'],
    Key: {
      name: lastModifiedKey
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

function deleteLastModifiedItem(scan) {
  const results = [];

  scan.forEach(item => {
    switch(item.name) {
        case "כללי":
            results[0] = item;
            break;
        case "חגים ומועדים":
            results[1] = item;
            break;
        case "קינוחים":
            results[2] = item;
            break;
        case "מאפים":
            results[3] = item;
            break;
        case "כשרות":
            results[4] = item;
            break;
    }
  });
  return results;
  /* for(let i=0; i < scan.length; i++) {
    if(scan[i]['name'] !== lastModifiedKey)
      results.push(scan[i]);
  } */
  
  // scan.forEach(element => {
  //   if(element['name'] === 'last-modified')
  //     delete scan.element;
  // });
}

// handleHttpRequest is the entry point for Lambda requests
exports.handler = async (event, context, callback) => {
    console.log('received event\n' + JSON.stringify(event));
    //console.log("query string: " + event['queryStringParameters']['lastModifiedDate']);
    let lastModified = "0";
    if(event['queryStringParameters'] && event['queryStringParameters']['lastModifiedDate']) {
      lastModified = event['queryStringParameters']['lastModifiedDate'];
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
      const results = deleteLastModifiedItem(scanResults);
      callback(null, setResponse(200, JSON.stringify(results)));
    }
    catch(err) {
      //callback(err); 
      const { statusCode, message } = err;
      if (statusCode !== undefined && message !== undefined) {
        callback(null, setResponse(statusCode, JSON.stringify(message)));
      } else {
        callback(null, setResponse(500, JSON.stringify(err)));
      }
    }
};