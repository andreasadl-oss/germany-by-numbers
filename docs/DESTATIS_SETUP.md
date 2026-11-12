# Connecting Destatis (GENESIS-Online)

Charts like the federal budget by ministry, individual taxes and causes of death
come from Destatis' GENESIS-Online database. Its API needs a free account. This
is a one-off task that only the repository owner can do. It takes about 10 minutes.

## 1. Create the account

1. Go to <https://www-genesis.destatis.de/> and choose **Registrieren** (top right).
2. Use an email address you check and a **new password you don't use anywhere
   else**. The account is free and only allows reading public statistics.
3. Confirm the email Destatis sends you and log in once.
4. Open your profile (**Mein Profil** / user settings) and look for an **API
   token** (sometimes called Webservice-Token). If there is one, copy it. If
   there isn't, the pipeline will use your username and password instead.

## 2. Store it as a GitHub secret (never in the code, never in chat)

1. On GitHub, open the repository → **Settings → Secrets and variables →
   Actions → New repository secret**.
2. Add **one** of these:
   - name `DESTATIS_TOKEN`, value: the API token, **or**
   - two secrets, `DESTATIS_USER` and `DESTATIS_PASSWORD`.
3. Save. GitHub encrypts secrets. They are hidden in the logs and stay hidden
   once the repository is public. They are not given to workflows run from
   pull requests opened from forks.

## 3. Tell Claude

Say "the Destatis secret is set". The fetcher for GENESIS tables is then written
and tested through a manual workflow run (Actions tab → *Refresh data and
publish site* → **Run workflow**).

## If something goes wrong

- If the token ever leaks, delete or change it in your Destatis profile and
  update the GitHub secret. Nothing else needs to change.
- The weekly refresh makes a few dozen requests, far below any usage limit.
- Data licence: Datenlizenz Deutschland – Namensnennung 2.0. Reuse is allowed
  as long as Destatis is named as the source. Each chart already does this.
