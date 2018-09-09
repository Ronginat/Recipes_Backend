// Load the AWS SDK for Node.js
const AWS = require('aws-sdk');
// Set the region 
AWS.config.update({region: process.env['REGION']});

// Create DynamoDB service object
//var docClient = new AWS.DynamoDB.DocumentClient();
let docClient = new AWS.DynamoDB({apiVersion: '2012-10-08'});


function setResponse(status, body){
  let response = {
      headers: {
          'Content-Type': 'application/json'},
      body: body,
      statusCode: status
  };
    
  return response;
}

function checkTableTime(lastModified, myCallBack, handlerCallBack){
  console.log('requested time: '+ lastModified);
  if(lastModified == 0){
    myCallBack(false, handlerCallBack);
  }
  else{
    const params = {
      TableName: process.env['TABLE'],
      Key: {
        name: {S: "last-modified"}
      }
    };
      
    docClient.getItem(params, function(err, data){
      if(err){
        console.log("Error", err);
        myCallBack(false, handlerCallBack);
      }
      else{
        //console.log("Success", data.Item);
        let lastModifiedTable = data.Item['date']['S'];
        let result = lastModified >= lastModifiedTable;
        //console.log("up to date? " + result);
        myCallBack(result, handlerCallBack);
      }
    });
  }
}

function scanTable(callback){
  const params = {
     TableName: process.env['TABLE'],
     Limit: process.env['LIMIT'],
  };
    
  let listData = [];

  docClient.scan(params, onScan);

  function onScan(err, data) {
    if (err) {
        console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
        callback(err);
    } 
    else {
      console.log("Scan succeeded. ", JSON.stringify(data.Items));
      listData = listData.concat(data.Items);

      // scan can retrieve a maximum of 1MB of data
      if (typeof data.LastEvaluatedKey != "undefined") {
          console.log("Scanning for more...");
          params.ExclusiveStartKey = data.LastEvaluatedKey;
          docClient.scan(params, onScan);
      } else {
        console.log("Scan Success, item count = ", listData.length);

        callback(err, setResponse(200, JSON.stringify(listData)));
      }
    }
  }
}

function checkTableTimeCallback(result, callback){
  console.log("result received = " + result);
  if(result){
    callback(null, setResponse(304, null));
      //setResponse(304, {'items': 'not modified'});
    }
    else{
      scanTable(callback);
    }
}


// handleHttpRequest is the entry point for Lambda requests
exports.handler = function(request, context, callback) {
    console.log('received event');
    
    if(request['pathParameters'] != undefined && request['pathParameters']['lastmodified'] != undefined){
        checkTableTime(request['pathParameters']['lastmodified'], checkTableTimeCallback, callback);
    }
    else{
      scanTable(callback);
    }
};



// // Load the AWS SDK for Node.js
// const AWS = require('aws-sdk');
// // Set the region 
// AWS.config.update({region: process.env['REGION']});

// // Create DynamoDB service object
// //const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
// var docClient = new AWS.DynamoDB.DocumentClient();

// const params = {
// // ExpressionAttributeValues: { },
// //   ":topic": {
// //     S: "PHRASE"
// //    }
// // },
// // FilterExpression: "",//"contains (Subtitle, :topic)",
// // ProjectionExpression: "",//"Title, Subtitle",
//  Limit: process.env['LIMIT'], //1000
//  TableName: process.env['TABLE']
// };

// // handleHttpRequest is the entry point for Lambda requests
// exports.getItemsHandler = function(request, context, callback) {
//     console.log('received event');
//   //try {
//     let response = {
//       headers: {
//           'Content-Type': 'application/json'},
//       body: '',
//       statusCode: 200
//     };

//     let listData = [];

//     docClient.scan(params, onScan);

//     function onScan(err, data) {
//       if (err) {
//           console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
//           callback(err);
//           //throw `Dynamo Get Error (${err})`
//       } else {
//           // print all the movies
//           console.log("Scan succeeded. ", JSON.stringify(data.Items));
//           listData = listData.concat(data.Items);
  
//           // continue scanning if we have more movies, because
//           // scan can retrieve a maximum of 1MB of data
//           if (typeof data.LastEvaluatedKey != "undefined") {
//               console.log("Scanning for more...");
//               params.ExclusiveStartKey = data.LastEvaluatedKey;
//               docClient.scan(params, onScan);
//           } else {
//             console.log("Scan Success, item count = ", listData.length);
//             response.body = JSON.stringify(listData);
//             callback(err, response);
//           }
//       }
//   }
// }





//     // Call DynamoDB to read the item from the table
//     let listData = [];
//     var scanExecute = function(callback) {
//       ddb.scan(params, function (err, data) {
//         if (err) {
//           console.log("Error", err);
//           throw `Dynamo Get Error (${err})`
//         } else {
//           listData.concat(data.Items);

//           if (data.LastEvaluatedKey) {
//             params.ExclusiveStartKey = data.LastEvaluatedKey;
//             scanExecute(callback);
//           } else {
//             // all results scanned. done!
//             //someCallback();
            
//             console.log("Success, item count = ", listData.length);
//             response.body = JSON.stringify(listData);
//             callback(err, response);
//           }
//         }
//       });
//     }

//     scanExecute(callback);
    

//   } catch (e) {
//     callback(e, null);
//   }
// }

