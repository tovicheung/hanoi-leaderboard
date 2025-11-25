Write-Output "Hosting on $((Get-NetIPAddress -InterfaceAlias Wi-Fi).IPAddress):8000";
deno run --unstable-kv --unstable-broadcast-channel --allow-net --allow-read --allow-env --env-file=.env main.ts
