## Todo

* support for hosting event on local network
    * IP-based access control
    

## HTTP API

Admin functions

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

* POST `/api/instance/delete`

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

* POST `/api/token/delete`

    Deletes an access token.
    ```json
    {
        "token": "my-old-secret-token"
    }
    ```

For `/api/instance/*`, a response is sent indicating success or failure.

## Socket API
The following communications are done through websocket:
* authentication
* role reporting
* refresh clients
* leaderboard data updates
* the following admin functions:
    * disconnect clients
    * temporarily allow input from clients
    * overriding admin sessions
