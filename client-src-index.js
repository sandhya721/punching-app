{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowSpecificBucketOnly",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:ListBucket",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::mylab-allowed-bucket-782412159456",
                "arn:aws:s3:::mylab-allowed-bucket-782412159456/*"
            ]
        },
        {
            "Sid": "DenyAllOtherBuckets",
            "Effect": "Deny",
            "Action": "s3:*",
            "NotResource": [
                "arn:aws:s3:::mylab-allowed-bucket-782412159456",
                "arn:aws:s3:::mylab-allowed-bucket-782412159456/*"
            ]
        }
    ]
}
