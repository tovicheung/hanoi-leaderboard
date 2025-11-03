This is a live leaderboard service used to host mathematics club events at my school.

## HTTP API

Public functions

* GET `/api/data`

    Returns the live JSON data.

The following admin functions require a bearer token.

* POST `/api/data`

    Returns the live JSON data.
    ```json
    [
        [ /* leaderboard 1 */ ],
        [ /* leaderboard 2 */ ]
    ]
    ```

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

* POST `/api/instance/import`

    Overwrite the data of the active instance with the provided JSON.
    ```json
    {
        "data": [[], []]
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
* status of ongoing run
* leaderboard data updates
* display controls
* authentication (`AUTH:`)
* role reporting
* cross-client communication (`!` and `@`)
* admin: live operations such as session-wise permission management (`ADMIN:`)
