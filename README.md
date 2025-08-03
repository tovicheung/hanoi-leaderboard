## HTTP API

The following admin functions are implemented using HTTP with a bearer token.

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

    Clone the data of the active instance to a new name.
    ```json
    {
        "name": "Backup of Important Instance"
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

* DELETE `/api/token/delete`

    Deletes an access token.
    ```json
    {
        "token": "my-old-secret-token"
    }
    ```

## Socket API
The following communications are done through websocket:
* leaderboard data updates
* authentication (`AUTH:`)
* role reporting
* cross-node communication (`!` and `@`)
* admin: live operations such as session-wise permission management (`ADMIN:`)
