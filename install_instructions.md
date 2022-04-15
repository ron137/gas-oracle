# Install git v2+

https://computingforgeeks.com/how-to-install-latest-version-of-git-git-2-x-on-centos-7/

```
yum -y install https://packages.endpointdev.com/rhel/7/os/x86_64/endpoint-repo.x86_64.rpm

sudo yum install git
```

# nvm

Git repo

```
https://github.com/nvm-sh/nvm
```

Install nvm and node v16

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash

export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm

nvm install 16
```

When you need to switch node versions:

```
nvm use 16
```

# pm2

```
npm install pm2 -g
```

# Start oracles

Considering you already cloned this:

```
npm install
```

## Start

```
pm2 start pm2.json
pm2 save
```

## Workaround for BSC bug

BSC oracle is not working by default:

```
Error: Number can only safely store up to 53 bits
```

```
Easy temporary fix:
Open file .\node_modules\number-to-bn\node_modules\bn.js\lib\bn.js
Go to line 506 assert(false, 'Number can only safely store up to 53 bits');
Replace it with ret = Number.MAX_SAFE_INTEGER;
```
