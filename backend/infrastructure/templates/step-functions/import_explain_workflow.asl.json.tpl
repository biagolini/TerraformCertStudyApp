{
  "Comment": "Bulk exam import Phase 2 (explanations): fan out over human-approved draft indices -> AgentCore review agent -> finalize as SUCCEEDED/PARTIAL/FAILED. Input: {jobId, sub, packId, draftIndices}. See import_workflow.asl.json.tpl for Phase 1 (structure extraction).",
  "StartAt": "GenerateExplanations",
  "States": {
    "GenerateExplanations": {
      "Type": "Map",
      "ItemsPath": "$.draftIndices",
      "MaxConcurrency": 4,
      "ItemSelector": {
        "jobId.$": "$.jobId",
        "sub.$": "$.sub",
        "packId.$": "$.packId",
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
                "Next": "ExplainFailedPassthrough"
              }
            ],
            "End": true
          },
          "ExplainFailedPassthrough": {
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
        "phase": "explain",
        "jobId.$": "$.jobId",
        "sub.$": "$.sub",
        "results.$": "$.results"
      },
      "End": true
    }
  }
}
