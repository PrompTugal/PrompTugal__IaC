# The AWS role for DNS (dns-apply)

Status: proposed by cl-6.infra@PrompTugal.dinis, 25 Nov 2026, for Dinis to create. On the pattern of SovereignWebsite__IaC's docs/aws-oidc.md (role `sovereignwebsite-factory-dns`).

The `DNS apply` workflow creates the records in `org/dns.json` that the promptugal.news zone lacks. It assumes this role through GitHub's OpenID Connect, so no AWS key is stored anywhere. The role can only CREATE records of four types under `*.promptugal.news` in that one zone. It cannot change or delete a record, write the apex, create or delete a zone, or touch the domain.

## 1. The OIDC provider
Account 745506449035 (SovereignWebsite's; Dinis, 25 Nov 2026) already has `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`. Nothing to do.

## 2. The role
Name: `promptugal-iac-dns`. Maximum session: 1 hour. Then set, in PrompTugal__IaC's `apply` environment, the variables `PT_AWS_ROLE_ARN` (its ARN) and `PT_ZONE_ID_NEWS` = `Z0663369UQ6WKN4WWZBK`.

**Trust policy** (only this repository's `apply` environment). Two subject forms are listed, as SovereignWebsite's role first had: the default (names) and the one with numeric IDs (organisation 353106737, repository 1472415783), which an organisation can choose and which stops a deleted and recreated repository of the same name from matching. Once DNS apply has run, keep only the form GitHub sent.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::745506449035:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": [
          "repo:PrompTugal/PrompTugal__IaC:environment:apply",
          "repo:PrompTugal@353106737/PrompTugal__IaC@1472415783:environment:apply"
        ]
      }
    }
  }]
}
```

**Permission policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CreateOurRecordsOnly",
      "Effect": "Allow",
      "Action": "route53:ChangeResourceRecordSets",
      "Resource": "arn:aws:route53:::hostedzone/Z0663369UQ6WKN4WWZBK",
      "Condition": {
        "ForAllValues:StringEquals": {
          "route53:ChangeResourceRecordSetsActions": ["CREATE"],
          "route53:ChangeResourceRecordSetsRecordTypes": ["A", "AAAA", "CNAME", "TXT"]
        },
        "ForAllValues:StringLike": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": ["*.promptugal.news"]
        }
      }
    },
    {
      "Sid": "ReadOurZone",
      "Effect": "Allow",
      "Action": ["route53:ListResourceRecordSets", "route53:GetHostedZone"],
      "Resource": "arn:aws:route53:::hostedzone/Z0663369UQ6WKN4WWZBK"
    },
    {
      "Sid": "ChangeStatus",
      "Effect": "Allow",
      "Action": "route53:GetChange",
      "Resource": "arn:aws:route53:::change/*"
    }
  ]
}
```

When a record ever needs changing or removing, that is proposed as its own change to this file and to `policy/abp.json`, for Dinis to merge.

## 3. Check
Run **DNS apply** by hand: with today's `org/dns.json` it plans nothing to create (every listed record exists).
