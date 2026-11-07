# Choosing the off-site backup destination

This guide is for the client. It explains what we need to switch on the encrypted
off-site copy of the site's backups, compares the storage services that work with it,
recommends one, and says exactly what to send us and how. Prices and service details were
read on **7 November 2026** from the sources listed at the end; check them again before
signing up, because they change.

## Why an off-site copy

Every night at 16:30 UTC (03:30 in Melbourne during daylight saving, 22:30 in Dhaka) the
server takes a backup of the database and the uploaded recordings, and keeps the newest 14.
Those backups sit on the same server as the site. If the server is lost, broken into,
deleted by mistake or its provider fails, they are lost with it.

The off-site copy sends each night's backup to a storage service you choose, in a
different company's data centre. It is encrypted on our server with
[restic](https://restic.net) **before** it leaves, using a password only you and the
server hold, so the storage company cannot read the children's records or voices. It is
built and installed with the site, but stays switched off until you choose a destination
([Off-site copies](PRODUCTION_OPERATIONS.md#off-site-copies)). Meanwhile we rehearse it
on the server with a throwaway local repository that never leaves it
([Off-site rehearsal](PRODUCTION_OPERATIONS.md#off-site-rehearsal)), so that only your
destination and its key are missing.

## How much space, and what it costs

One backup is a single compressed file holding the database, a manifest and all uploaded
recordings. Recordings are audio, which barely compresses, and each night's file differs
throughout, so **each copy kept costs about one full backup** of space.

| Use | One backup | Kept with the proposed retention (about 24 copies) |
| --- | --- | --- |
| Typical small school (about 200 to 300 phone recordings) | 0.25 to 0.4 GB | about 6 to 10 GB |
| Heavier use (WAV uploads, second takes) | about 1 GB | about 25 GB |
| Upper bound (every lesson slot recorded twice at the 12 MB limit) | about 4.5 GB | about 110 GB |

These are estimates: production has no real data yet. We will read the real size after the
first week and tell you. Until you confirm the retention, nothing is deleted off-site and
the copy grows by one backup a night: about 7.5 to 12 GB a month for a typical school.

Monthly storage cost (request charges are negligible at this size):

| Service | Typical (6 to 10 GB) | About 25 GB | About 110 GB |
| --- | --- | --- | --- |
| Backblaze B2 | US$0 (first 10 GB free) | about US$0.10 | about US$0.70 |
| Cloudflare R2 | US$0 (first 10 GB free) | about US$0.23 | about US$1.50 |
| Amazon S3, Sydney | about US$0.15 to 0.25 | about US$0.63 | about US$2.75 |
| Microsoft Azure, Australia East (Hot) | about US$0.12 to 0.20 | about US$0.50 | about US$2.20 |
| Google Cloud Storage, Sydney | about US$0.14 to 0.23 | about US$0.58 | about US$2.53 |
| Wasabi | US$7.99 (1 TB minimum charge) | US$7.99 | US$7.99 |

Restoring one backup costs nothing on B2, R2 and Wasabi, nothing on S3 and Azure within
their 100 GB of free monthly download, and about US$0.19 per GB to Australia on Google
Cloud.

## The options

All of these work with the server's off-site job, which accepts `s3:` (Amazon S3 and
S3-compatible services), `b2:`, `azure:`, `gs:` and `rest:https://` repositories, always
over HTTPS.

| Service | How the server connects | Nearest location | Storage price | Downloads and requests | Free allowance | Catches |
| --- | --- | --- | --- | --- | --- | --- |
| **Backblaze B2** (recommended) | `s3:` to B2's S3 endpoint | US West (no Asia-Pacific region) | US$6.95 per TB a month | Downloads free up to 3 times what is stored; requests free | First 10 GB, always | Region chosen at sign-up, cannot change |
| **Cloudflare R2** (runner-up) | `s3:` to the account's R2 endpoint | "Oceania" or "Asia-Pacific" hint, best effort | US$0.015 per GB a month | Downloads always free; uploads US$4.50 per million requests | 10 GB a month | Needs a payment card before keys can be made; no deletion lock usable with restic |
| Amazon S3 | `s3:` with the region set | Sydney or Melbourne | US$0.025 per GB a month (Sydney) | First 100 GB a month free, then US$0.114 per GB | New-account credits only | Nonprofit credits exclude schools |
| Wasabi | `s3:` to the regional endpoint | Sydney; Singapore for Bangladesh | US$7.99 per TB a month | Free, subject to Wasabi's free-egress policy | 30-day trial | Charged for at least 1 TB (US$7.99 a month) and 90 days per file |
| Microsoft Azure Blob | `azure:` with an account name and a SAS key | Australia East or Southeast | US$0.02 per GB a month (Hot) | First 100 GB a month free | 12 months for new accounts | More set-up; nonprofit grant excludes nonprofit schools |
| Google Cloud Storage | `gs:` with a service-account key file | Sydney or Melbourne | US$0.023 per GB a month | US$0.19 per GB to Australia | None in Australian regions | Deleted data billed 7 more days by default |
| Your own restic REST server | `rest:https://` | Wherever you put it | No fee: your hardware and power | Your internet connection | Free software | Needs an always-on machine, a public HTTPS name with a trusted certificate, and someone to look after it |

A client-owned REST server gives the strongest protection: started in `--append-only`
mode, the server's key can add copies but never delete them, even if the server is broken
into. Retention then runs on your machine, not on ours. It suits an organisation with a
volunteer who can run it, ideally as a second copy.

## Our recommendation

**Backblaze B2**, reached through its S3-compatible endpoint (restic's own documentation
recommends this over B2's native connection). For a school this size it is the cheapest
reliable choice:

- a typical school stays inside the free 10 GB, and even the upper bound costs well under
  a dollar a month;
- restoring costs nothing, and there is no minimum size, minimum duration or monthly
  minimum;
- one key limited to one bucket is made in the web console;
- deletion locks (Object Lock) can be added later if wanted.

The downside: B2 has no Asia-Pacific region, so the encrypted copies sit in the United
States (US West is the nearest). They are encrypted before they leave the server, and
nobody without the repository password can read them.

**Runner-up: Cloudflare R2.** The same free 10 GB, downloads always free, a key limited
to one bucket, and a best-effort placement in Oceania. Above 10 GB it costs about twice
as much as B2 (about US$1.50 a month at 110 GB), it needs a payment card on file, and it
has no deletion lock that works with restic.

**If the data must stay in Australia** (for example, a policy for children's records):
Amazon S3 in Sydney or Melbourne costs cents a month; Wasabi Sydney is a flat US$7.99 a
month. Tell us and we will give you the steps for either.

## Setting up Backblaze B2

Whoever pays the bill should own the account, so it stays the organisation's.

1. Sign up at backblaze.com. At sign-up, choose the region: **US West** is the nearest.
   It cannot be changed later.
2. Under **Buckets**, choose **Create a Bucket**. Give it a unique name, for example
   `YOUR-ORG-bangla-backups`, keep **Files in Bucket** as **Private**, and leave
   **Object Lock** disabled for now.
3. Open the bucket's **Lifecycle Settings** and choose **Keep only the last version of
   the file**. Without this, B2 only hides deleted files and keeps charging for them, so
   the retention would free no space.
4. Note the bucket's **Endpoint** shown on the bucket page, for example
   `s3.us-west-004.backblazeb2.com`.
5. Under **Application Keys**, choose **Add a New Application Key**: name it
   `bangla-adventures-server`, allow access to **this bucket only**, choose
   **Read and Write**, and optionally set the file name prefix `bangla-adventures/`.
   Leave the duration empty, or set an expiry and a reminder to replace the key.
6. Copy the **keyID** and the **applicationKey** straight into your password manager:
   the applicationKey is shown only once. If it is lost, delete the key and make a new
   one; nothing else changes.

This key reaches only that bucket. It keeps working if the account's master key changes,
and can be deleted on its own at any time. On the server it becomes:

```dotenv
RESTIC_REPOSITORY=s3:https://s3.us-west-004.backblazeb2.com/YOUR-ORG-bangla-backups/bangla-adventures
AWS_ACCESS_KEY_ID=THE-KEY-ID
AWS_SECRET_ACCESS_KEY=THE-APPLICATION-KEY
```

### Setting up Cloudflare R2 instead

1. In the Cloudflare dashboard, open **R2** and add a payment method (Cloudflare asks
   before any key can be made).
2. **Create bucket**: any name; for location keep **Automatic** or give the hint
   **Oceania**.
3. **Manage R2 API Tokens > Create Account API token**: permission **Object Read &
   Write**, applied to **this bucket only**; an expiry date is optional.
4. Copy the **Access Key ID**, the **Secret Access Key** (shown only once) and the
   account's S3 endpoint, `https://ACCOUNT-ID.r2.cloudflarestorage.com`.

On the server it becomes `RESTIC_REPOSITORY=s3:https://ACCOUNT-ID.r2.cloudflarestorage.com/BUCKET/bangla-adventures`
with the two keys as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

## What to send us, and how

Please send:

1. **The destination**: the service, the bucket name and its endpoint (for B2, the
   endpoint from step 4).
2. **Its access key**: the key ID and the secret (for B2, the keyID and applicationKey).
3. **The retention decision** (below): agreed as proposed, changed, or not yet.
4. **Two names**: the person **responsible for the backups** (receives the failure
   alerts, approves a restore, keeps the storage account paid), and the
   **key custodian** (below), with a deputy for each.

**Never send the key by email, chat, text message or in a GitHub issue.** Share it either:

- as a shared item in your organisation's password manager (for example Bitwarden or
  1Password), shared with our technical contact only; or
- as a one-time secret link that expires after one viewing and within a day, with its
  passphrase, if it has one, sent through a different channel.

Items 1, 3 and 4 are not secret and can go by email. We put the key only into a private
settings file on the server that only the deployment account can read; it is never stored
in the code repository, in GitHub or in any log.

## The key custodian and the repository password

restic encrypts every off-site copy with the **repository password**. We create it on the
server when we connect your destination, and hand it to the key custodian through the
same password manager or one-time link. The custodian keeps it in the organisation's
password manager, with the deputy able to reach it, and never only on one person's
device.

Why it matters: **without this password the off-site copies cannot be read by anyone**,
not by us, not by the storage company, not by you. The password exists on the server and
with the custodian. If the server is lost, the custodian's copy is the only way to use the
backups. It cannot be reset or recovered. The storage access key is different: if it is
lost or leaked, you delete it and make a new one, and the copies are unaffected.

A good custodian is someone who will still be with the organisation in a few years, for
example the secretary or treasurer, not a volunteer who may leave.

## The retention decision

Retention says which off-site copies are kept. The proposal is **14 daily, 8 weekly and 6
monthly copies**: the last two weeks day by day, then one a week for two months, then one
a month for six months, about 24 copies and six months of history in all. Older copies
are deleted automatically, after each night's copy succeeds.

Until you confirm, **nothing is deleted off-site** and every nightly copy is kept, which
only grows the storage bill (see the table above). You can choose different numbers, or
keep everything for longer; tell us and we set them. The rehearsal on the server
previews this policy without deleting anything
([Off-site rehearsal](PRODUCTION_OPERATIONS.md#off-site-rehearsal)).

The 14 backups kept on the server itself are separate and stay as they are.

## What happens next

Once we have your answers, we create the repository password, connect the destination,
make the first copy and check it. From then on the copy runs every night at 17:15 UTC,
the 5-minute monitor raises an alert if no copy has succeeded for 48 hours, and the daily
GitHub check emails the responsible person if anything fails. We will also do one restore
from the off-site copy with you, as the recovery exercise.

## Sources

Read on 7 November 2026:

- Backblaze B2: [pricing](https://www.backblaze.com/cloud-storage/pricing),
  [transaction pricing](https://www.backblaze.com/cloud-storage/transaction-pricing)
  (still shows the older US$0.005 per GB; the main pricing page shows US$6.95 per TB),
  [data regions](https://www.backblaze.com/docs/cloud-storage-data-regions),
  [application keys](https://www.backblaze.com/docs/cloud-storage-application-keys),
  [Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock).
- Cloudflare R2: [pricing](https://developers.cloudflare.com/r2/pricing/),
  [data location](https://developers.cloudflare.com/r2/reference/data-location/),
  [bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/),
  [API tokens](https://developers.cloudflare.com/r2/api/tokens/),
  [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).
- Wasabi: [pricing](https://wasabi.com/pricing), [pricing FAQ](https://wasabi.com/pricing/faq),
  [service URLs](https://docs.wasabi.com/docs/what-are-the-service-urls-for-wasabi-s-different-storage-regions),
  [Object Lock](https://docs.wasabi.com/docs/object-locking).
- Amazon S3: [pricing](https://aws.amazon.com/s3/pricing/) and the official price list
  for ap-southeast-2 (published 4 November 2026),
  [free tier](https://aws.amazon.com/free/),
  [nonprofit credits](https://aws.amazon.com/government-education/nonprofits/nonprofit-credit-program/).
- Microsoft Azure: [Blob storage pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)
  and the Azure Retail Prices API for Australia East,
  [nonprofit eligibility](https://www.microsoft.com/en-us/nonprofits/eligibility).
- Google Cloud Storage: [pricing](https://cloud.google.com/storage/pricing),
  [soft delete](https://cloud.google.com/storage/docs/soft-delete),
  [Google for Nonprofits eligibility](https://www.google.com/nonprofits/eligibility/).
- restic: [preparing a repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)
  (B2, S3-compatible, Azure, Google Cloud and REST server sections) and the
  [REST server README](https://github.com/restic/rest-server).

The space estimates come from the backup format in `scripts/backup_restore.py` and the
upload limits in the app, not from real production data, which does not exist yet.
