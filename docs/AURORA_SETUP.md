# Connecting ExecutiveOS to Amazon Aurora PostgreSQL

Follow these once. Total time ~20-30 min (most of it Aurora provisioning).

## 0. Get AWS access + credits
Use the hackathon's credit form (Get Started → "Fill out the request form to get
AWS & v0 Credits"). Sign in to the AWS Console.

## 1. Create the Aurora PostgreSQL cluster
AWS Console → **RDS** → **Create database**:
- Engine: **Amazon Aurora** → **Aurora PostgreSQL-Compatible**.
- Templates: **Dev/Test** (cheapest) or Production.
- Cluster identifier: `executiveos`.
- Master username: `postgres`; set a **strong master password** (save it).
- Instance: **Serverless v2**, min 0.5 ACU.
- **Connectivity → Public access: Yes** (so Vercel + your laptop can reach it).
- Create a new **security group** (or note the default one) — you'll edit it next.
- Create database. Wait until status is **Available** (a few minutes).

## 2. Open the firewall (security group)
RDS → your cluster → **Connectivity & security** → click the **VPC security group** →
**Inbound rules → Edit**:
- Add rule: Type **PostgreSQL**, Port **5432**, Source **My IP** (for local dev).
- For the Vercel deployment, Vercel serverless egress IPs are dynamic, so add a
  second rule Source **0.0.0.0/0** (Anywhere-IPv4). Security tradeoff — it's
  acceptable for a hackathon because access still requires the master password +
  TLS. For production, use **Amazon RDS Proxy** or Vercel's static-IP add-on
  instead and restrict the source.

## 3. Get the connection string
RDS → your cluster → copy the **Writer endpoint** (looks like
`executiveos.cluster-xxxx.us-east-1.rds.amazonaws.com`). Build:

```
postgresql://postgres:YOUR_PASSWORD@executiveos.cluster-xxxx.us-east-1.rds.amazonaws.com:5432/postgres
```

(If your password has special characters like `@ : / #`, URL-encode them.)

## 4. Configure + apply the schema (local)
Add to `.env`:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@...rds.amazonaws.com:5432/postgres
```
Then apply the schema with the bundled script (no psql install needed):
```
npm run db:setup
```
Expect: `✓ Connected … ✓ Schema applied. N tables in public schema.`
If it fails, the message says why (usually password or the security-group rule).

## 5. Run locally and verify
```
npm run dev
```
- The header chips should read **Aurora · connected** and **Bedrock · connected**.
- Sign up, upload a dataset, generate a CEO Brief → all persisted in Aurora.

## 6. Deploy to Vercel
In the Vercel project → Settings → Environment Variables, add (for Production):
- `DATABASE_URL` = the same Aurora string
- `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`, `BEDROCK_AWS_REGION` = AWS credentials with Bedrock access

Redeploy. Open the app → both chips green = live on the hackathon stack.

## Troubleshooting
- **db:setup hangs / times out** → security-group inbound rule missing for your IP.
- **password authentication failed** → wrong password or it needs URL-encoding.
- **no pg_hba / SSL** → leave SSL on (the app/script use TLS by default). Only set
  `PGSSL=disable` for a local non-TLS Postgres.
- **Chip red on Vercel but green locally** → add the `0.0.0.0/0` inbound rule (or
  RDS Proxy) so Vercel's serverless IPs can connect.
