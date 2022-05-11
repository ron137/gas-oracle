const fetch = require('node-fetch');

// TODO
// need to pick gasList and build file from it.

(async () => {
    // get latest block number
    const getBlockHeight = async () => {
        const url = 'https://rpc.cosmos.network'
        const res = await fetch(`${url}/block`);
        const block = await res.json();
        const height = block.result.block.header.height;

        return height;
    };

    // get a list of gas prices for every tx in the block
    const getGasList = async block => {
        const url = 'https://api.cosmos.network/cosmos/tx/v1beta1';
        const res = await fetch(`${url}/txs?events=tx.height=${block}`);
        const tx = await res.json();
        
        const list = tx.txs.map(e => {
            try {
                if (!e.auth_info.fee.amount.length) {
                    return 0;
                }
                return e.auth_info.fee.amount[0].amount;
            }
            catch(error) {
                console.log(error);
                console.log(e);
                return 0;
            }
        }).filter(e => parseInt(e) > 0);

        return list;
    };

    // automatically calculate time interval between calls
    const dynamicInterval = (timeInterval, state) => {
        let minInterval = 1000;
        let maxInterval = 15000;
        const speedFactor = 1.1;

        // not yet started
        if (state === -1) {
            return 10;
        }
        // fetch success
        if (state === 1){
            // increase speed
            timeInterval /= speedFactor;
            timeInterval = Math.max(minInterval, timeInterval);
        }
        // fetch fail
        else {
            // reduce speed
            timeInterval *= speedFactor;
            timeInterval = Math.min(maxInterval, timeInterval);
        }
    
        return timeInterval;
    };

    let lastBlock = 0;
    let timeInterval = 5000;

    // loop function
    const loop = async () => {
        const currentBlock = await getBlockHeight();

        let state = 0;
        if (currentBlock > lastBlock) {
            const gasList = await getGasList(currentBlock);

            if (gasList.length) {
                console.log(`${new Date().toISOString()}: New block ${ currentBlock } read. Next update: ${ timeInterval.toFixed(1) }ms`);
                // console.log(gasList);
                state = 1;
            }

            lastBlock = currentBlock;
        }
        else {
            console.log(`Failed to fetch new blocks. I will try again in ${ timeInterval.toFixed(1) }ms`);
        }

        timeInterval = dynamicInterval(timeInterval, state);
        setTimeout(() => loop(), timeInterval);
    };
    loop();
})();