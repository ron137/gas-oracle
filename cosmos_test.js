const fetch = require('node-fetch');
const fs = require('fs');

const args = {
    sampleSize: 1000,
    timeInterval: 5000,
};

// receive args
process.argv.forEach((val, index, array) => {
    if ((val == '-s' || val == '--sample-size') && array[index+1]){
        args.sampleSize = array[index+1];
    }
    if ((val == '-t' || val == '--time-interval') && array[index+1]){
        args.timeInterval = array[index+1];
    }
});

let lastBlock = 0;
let timeInterval = args.timeInterval;
const blocks = {};

(async () => {
    // get latest block number
    const getBlockHeight = async () => {
        const url = 'https://rpc.cosmos.network'
        const res = await fetch(`${url}/block`);
        const block = await res.json();
        // console.log(block)
        const height = block.result.block.header.height;

        return height;
    };

    // get a list of gas prices for every tx in the block
    const getBlock = async blockNumber => {
        const url = 'https://api.cosmos.network/cosmos/tx/v1beta1';
        const res = await fetch(`${url}/txs?events=tx.height=${blockNumber}`);
        const tx = await res.json();
        // console.log(tx)
        
        const gasList = tx.txs.map(e => {
            try {
                if (!e.auth_info.fee.amount.length) {
                    return 0;
                }
                return parseFloat(e.auth_info.fee.amount[0].amount);
            }
            catch(error) {
                console.log(error);
                console.log(e);
                return 0;
            }
        }).filter(e => parseFloat(e) > 0);

        const block = {
            gasList: gasList,
            number: blockNumber,
        };

        if (tx && tx.tx_responses && tx.tx_responses.length) {
            block.timestamp = parseInt(new Date(tx.tx_responses[0].timestamp).getTime() / 1000);
            block.avgGas = tx.tx_responses.reduce((p,c) => p + parseFloat(c.gas_used), 0) / tx.tx_responses.length;
        }

        return block;
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

    const calcBlockStats = () => {
        // sort blocks by timestamp, then remove blocks with no tx
        const b = Object.values(blocks).sort((a,b) => a.timestamp - b.timestamp).filter(e => e.ntx);

        // reshape blocks object to be arrays of each field
        const result = Object.fromEntries(Object.keys(b[0]).map(e => [e, []]));
        b.forEach(block => Object.keys(result).forEach(key => result[key].push(block[key])));

        // last block
        const lastBlock = parseInt(Object.keys(blocks).sort((a,b) => parseInt(b) - parseInt(a))[0]);
        result.lastBlock = lastBlock;
        // timestamp from last block
        result.lastTime = blocks[lastBlock].timestamp;

        fs.writeFileSync(`./blockStats_cosmos.json`, JSON.stringify(result));
        return result;
    };

    const recordBlocks = async block => {
        blocks[block.number] = {
            ntx: block.gasList.length,
            timestamp: block.timestamp,
            minGwei: block.gasList.sort((a,b) => a-b),
            avgGas: block.avgGas,
        };

        // sort the blocks and discard if higher than sampleSize
        const sortedBlocks = Object.keys(blocks).sort((a,b) => parseInt(a) - parseInt(b));
        if (sortedBlocks.length > args.sampleSize){
            delete blocks[sortedBlocks[0]];

            calcBlockStats();
            console.log(`${new Date().toISOString()}: New block ${ block.number } read. Next update: ${ timeInterval.toFixed(1) }ms`);
        }
        else{
            // pretty progress bar
            const barSize = 50;
            const filledBars = parseInt(sortedBlocks.length / args.sampleSize * barSize);
            const barString = [...Array(filledBars).fill('#'), ...Array(barSize - filledBars).fill('=')].join('');
            if (sortedBlocks.length == args.sampleSize){
                const barString = Array(barSize).fill('#').join('');
                console.log(`[${barString}] ${sortedBlocks.length} / ${args.sampleSize}`);
            }
            else{
                console.log(`[${barString}] ${sortedBlocks.length} / ${args.sampleSize}`);
            }
        }

    };

    // loop function
    const loop = async () => {
        const currentBlock = await getBlockHeight();
        // console.log(currentBlock);

        let state = 0;
        if (currentBlock > lastBlock) {
            const block = await getBlock(currentBlock);
            // console.log(block)

            if (block) {
                // console.log(block);
                recordBlocks(block);
                state = 1;
            }

            lastBlock = currentBlock;
        }

        // get previous blocks
        if (Object.keys(blocks).length < args.sampleSize) {
            // get batches of 10 blocks

            for (let i=0 ; i<10 ; i++) {
                const firstBlock = Object.keys(blocks).sort((a,b) => a-b)[0];
    
                const getPrevBlock = async blockNumber => {
                    const block = await getBlock(blockNumber);
                    return block ? block : await getPrevBlock(blockNumber - 1);
                };
                const block = await getPrevBlock(firstBlock - 1);
                recordBlocks(block);
    
                state = -1;
            }
        }

        if (state === 0) {
            console.log(`Failed to fetch new blocks. I will try again in ${ timeInterval.toFixed(1) }ms`);
        }

        timeInterval = dynamicInterval(timeInterval, state);
        setTimeout(() => loop(), timeInterval);
    };
    loop();
})();