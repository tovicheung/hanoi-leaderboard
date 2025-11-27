This is a live leaderboard system, which is a part of a mathematics club event at my school.

## Schema

Leaderboard data is stored in the following format:

```json
{
    "lb4": [
        { "name": "John", "score": 12345 },
        { "name": "Peter", "score": 12346 },
        { "name": "Chris", "score": 12347 }
    ],
    "lb5": [ /* ... */ ]
}
```

## Authentication

There are 3 types of authentication for websockets, as described in backend:

```ts
type Auth = { type: "none" }
    | { type: "admin" }
    | { type: "token", token: string, expireIn: number }
    | { type: "elevated", timestamp: number }
```

* **Admins** have full access to all features

    * Admins can create and control **tokens**.

* Event helpers can use their **token** to authenticate and get input permission, allowing them to insert and modify leaderboard data (for the active leaderboard only).

* Admins can also **elevate** a session to temporarily grant them input permission via the admin dashblard.


## HTTP API

Public functions:

* GET `/api/data`

    Returns the active leaderboard data.

The following functions require the admin bearer token:

* POST `/api/data`

* POST `/api/instance/create`
    
    Create a new instance.
    ```json
    {
       "name": "My New Instance" 
    }
    ```

* POST `/api/instance/switch`

    Switch the active instance. Reloads all non-admin clients.
    ```json
    {
        "name": "My New Active Instance"
    }
    ```

* DELETE `/api/instance/delete`

    Delete an instance. The instance to be deleted should not be the active instance.
    ```json
    {
        "name": "My Unused Instance"
    }
    ```

* POST `/api/instance/clone`

    Clones an instance.
    ```json
    {
        "from": "Important Instance",
        "to": "Backup of Important Instance"
    }
    ```

* POST `/api/config/update`

    Updates the configuration of the server. The json object should be a subset of the full configuration object.
    ```json
    {
        "inputAccess": "restricted",
        "outputAccess": "everyone"
    }
    ```
    Accepted string values for access control are `everyone`, `restricted` and `none`.

* POST `/api/token/create`

    Creates a new access token with expiry.
    ```json
    {
        "token": "my-secret-token",
        "expireIn": 1751198559611
    }
    ```
    
* POST `/api/token/modify`

    Modify the expiry of a token
    ```json
    {
        "token": "my-secret-token",
        "expireIn": 1751198559612
    }
    ```

* DELETE `/api/token/delete`

    Deletes an access token.
    ```json
    {
        "token": "my-old-secret-token"
    }
    ```

## Socket API

The following communications are done through websocket:
* leaderboard data updates (`DATA:`)
* authentication (`AUTH:`)
* role reporting
* cross-node communication (`!` and `@`)
    * status of ongoing run
    * display controls
* admin: live operations such as client management (`ADMIN:`)
