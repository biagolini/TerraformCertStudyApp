{
  "Comment": "Bulk exam import Phase 1 (structure only): preprocess -> per-question Bedrock extraction fan-out -> finalize as AWAITING_REVIEW. See import_explain_workflow.asl.json.tpl for Phase 2 (explanation generation).",
  "StartAt": "Preprocess",
  "States": {
    "Preprocess": {
      "Type": "Task",
      "Resource": "${preprocess_lambda_arn}",
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException", "Lambda.TooManyRequestsException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "PreprocessFailed"
        }
      ],
      "Next": "ExtractQuestions"
    },
    "PreprocessFailed": {
      "Type": "Fail",
      "Error": "PreprocessFailed",
      "Cause": "Preprocessing the uploaded file failed - see the import-preprocess Lambda logs. The job record was already marked FAILED by the Lambda itself before it raised."
    },
    "ExtractQuestions": {
      "Type": "Map",
      "ItemsPath": "$.chunks",
      "MaxConcurrency": 4,
      "ItemSelector": {
        "chunk.$": "$$.Map.Item.Value",
        "jobId.$": "$.jobId",
        "sub.$": "$.sub",
        "packId.$": "$.packId",
        "modelId.$": "$.modelId"
      },
      "ResultPath": "$.results",
      "ItemProcessor": {
        "ProcessorConfig": { "Mode": "INLINE" },
        "StartAt": "Extract",
        "States": {
          "Extract": {
            "Type": "Task",
            "Resource": "${extract_lambda_arn}",
            "Retry": [
              {
                "ErrorEquals": ["Bedrock.ThrottlingException", "Bedrock.ModelTimeoutException", "Lambda.ServiceException", "Lambda.TooManyRequestsException"],
                "IntervalSeconds": 3,
                "MaxAttempts": 3,
                "BackoffRate": 2
              }
            ],
            "Catch": [
              {
                "ErrorEquals": ["States.ALL"],
                "ResultPath": "$.error",
                "Next": "ExtractFailedPassthrough"
              }
            ],
            "End": true
          },
          "ExtractFailedPassthrough": {
            "Type": "Pass",
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
        "phase": "extract",
        "jobId.$": "$.jobId",
        "sub.$": "$.sub",
        "results.$": "$.results"
      },
      "End": true
    }
  }
}
