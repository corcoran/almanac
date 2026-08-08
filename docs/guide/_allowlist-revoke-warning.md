::: warning Removing a line does not revoke access
The API's allowlist check applies to *provisioning*, not to every request: a user
who already exists in the database keeps working after you delete their line. To
actually cut off access, remove the account and revoke its tokens as well.
:::
