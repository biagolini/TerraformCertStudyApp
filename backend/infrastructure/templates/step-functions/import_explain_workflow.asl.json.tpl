{
  "Comment": "Bulk exam import Phase 2 (explanations): fan out over human-approved draft indices -> AgentCore review agent -> finalize as SUCCEEDED/PARTIAL/FAILED. Input: {jobId, sub, packId, bankId, draftIndices, modelId, timeoutSeconds, taskTimeoutSeconds, maxConcurrency}. Transient failures are retried by name (the Lambda raises named exceptions); after retries, the Catch counts the failure on the job with a direct DynamoDB call, so a retried question is never counted twice. See import_workflow.asl.json.tpl for Phase 1.",
  "StartAt": "GenerateExplanations",
  "States": {
    "GenerateExplanations": {
      "Type": "Map",
      "ItemsPath": "$.draftIndices",
      "MaxConcurrencyPath": "$.maxConcurrency",
      "ItemSelector": {
        "jobId.$": "$.jobId",
        "sub.$": "$.sub",
        "packId.$": "$.packId",
        "bankId.$": "$.bankId",
        "modelId.$": "$.modelId",
        "timeoutSeconds.$": "$.timeoutSeconds",
        "taskTimeoutSeconds.$": "$.taskTimeoutSeconds",
        "draftIndex.$": "$$.Map.Item.Value"
      },
      "ResultPath": "$.results",
      "ItemProcessor": {
        "ProcessorConfig": { "Mode": "INLINE" },
        "StartAt": "Explain",
        "States": {
          "Explain": {
            "Type": "Task",
            "Resource": "${explain_lambda_arn}",
            "TimeoutSecondsPath": "$.taskTimeoutSeconds",
            "Retry": [
              {
                "ErrorEquals": ["ReviewAgentThrottled", "Lambda.TooManyRequestsException", "Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException"],
                "IntervalSeconds": 10,
                "MaxAttempts": 4,
                "BackoffRate": 2,
                "JitterStrategy": "FULL"
              },
              {
                "ErrorEquals": ["ReviewAgentMalformedOutput"],
                "IntervalSeconds": 2,
                "MaxAttempts": 1
              },
              {
                "ErrorEquals": ["ReviewAgentTimeout", "States.Timeout"],
                "IntervalSeconds": 5,
                "MaxAttempts": 1
              }
            ],
            "Catch": [
              {
                "ErrorEquals": ["States.ALL"],
                "ResultPath": "$.error",
                "Next": "RecordFailure"
              }
            ],
            "End": true
          },
          "RecordFailure": {
            "Type": "Task",
            "Resource": "arn:aws:states:::dynamodb:updateItem",
            "Parameters": {
              "TableName": "${table_name}",
              "Key": {
                "pk": { "S.$": "States.Format('USER#{}', $.sub)" },
                "sk": { "S.$": "States.Format('IMPORTJOB#{}', $.jobId)" }
              },
              "UpdateExpression": "ADD processedCount :one, failedCount :one",
              "ExpressionAttributeValues": { ":one": { "N": "1" } }
            },
            "ResultPath": null,
            "Retry": [
              { "ErrorEquals": ["States.ALL"], "IntervalSeconds": 2, "MaxAttempts": 3, "BackoffRate": 2 }
            ],
            "Catch": [
              { "ErrorEquals": ["States.ALL"], "ResultPath": null, "Next": "FailedItem" }
            ],
            "Next": "FailedItem"
          },
          "FailedItem": {
            "Type": "Pass",
            "Parameters": {
              "index.$": "$.draftIndex",
              "status": "FAILED",
              "errorType.$": "$.error.Error",
              "cause.$": "$.error.Cause"
            },
            "End": true
          }
        }
      },
      "Next": "Finalize"
    },
    "Finalize": {
      "Type": "Task",
      "Resource": "${finalize_lambda_arn}",
      "Parameters": {
        "phase": "explain",
        "jobId.$": "$.jobId",
        "sub.$": "$.sub",
        "results.$": "$.results"
      },
      "End": true
    }
  }
}
