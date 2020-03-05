require('colors');
const FlexContract = require('flex-contract');
const fetch = require('node-fetch');
const process = require('process');
const { artifacts: assetProxyArtifacts } = require('@0x/contracts-asset-proxy');
const solpp = require('solpp');
const path = require('path');
const _ = require('lodash');
const { URLSearchParams } = require('url');
const secrets = require('../secrets.json');

const NETWORKS = [
    'main',
    'ropsten',
    'kovan'
];

const BRIDGES_TO_DEPLOY = [
    'KyberBridge',
    'Eth2DaiBridge',
    'UniswapBridge',
    'CurveBridge',
];

(async () => {
    const sources = {
        ..._.zipObject(BRIDGES_TO_DEPLOY, await Promise.all(BRIDGES_TO_DEPLOY.map(
            bridgeName => solpp.processFile(
                require.resolve(`@0x/contracts-asset-proxy/contracts/src/bridges/${bridgeName}.sol`),
                { noPreprocessor: true },
            ),
        ))),
    };
    await Promise.all(NETWORKS.map(async network => {
        for (const bridgeName of BRIDGES_TO_DEPLOY) {
            const artifact = assetProxyArtifacts[bridgeName];
            const bridgeContract = new FlexContract(
                artifact.compilerOutput.abi,
                {
                    network,
                    bytecode: artifact.compilerOutput.evm.bytecode.object,
                    gasPriceBonus: 0.85,
                },
            );
            console.log(`Deploying bridge ${bridgeName.bold} on ${network}...`);
            const r = await bridgeContract.new().send({ key: secrets.deployerKey });
            if (!r.status) {
                throw new Error(`failed to deploy bridge ${bridgeName.bold} on ${network}`);
            }
            console.log(`Deployed ${bridgeName.bold} on ${network}: ${r.contractAddress.green.bold}`);
            try {
                await delay(() => verifySource({
                    network,
                    artifact,
                    address: r.contractAddress,
                    name: bridgeName,
                    code: sources[bridgeName],
                }));
            } catch (err) {
                console.error(err);
            }
        }
    }));
})().catch(() => process.exit(-1)).then(() => process.exit(0));

async function delay(cb, delay=90) {
    return new Promise((accept, reject) => {
        setTimeout(() => {
            try {
                accept(cb());
            } catch (err) {
                reject(err);
            }
        }, delay * 1000);
    });
}

async function verifySource(opts) {
    const { network, address, name, artifact, code, libraries } = opts;
    const apiNetworkPrefix = network === 'main' ? 'api' : `api-${network}`;
    const compilerInput = createCompilerStandardInput(artifact, code);
    const params = new URLSearchParams();
    params.set('apikey', secrets.etherscanKey);
    params.set('module', 'contract');
    params.set('action', 'verifysourcecode');
    params.set('contractaddress', address);
    params.set('sourceCode', JSON.stringify(compilerInput));
    params.set('codeformat', 'solidity-standard-json-input');
    params.set('contractname', `${Object.keys(compilerInput.sources)[0]}:${artifact.contractName}`);
    params.set('compilerversion', artifact.compiler.version.slice(0, -3).slice(8));
    params.set('licenseType', 12);
    console.log(`Verifying source code for ${name.bold} on ${network} at ${address.green.bold}...`);
    const r = await fetch(
        `https://${apiNetworkPrefix}.etherscan.io/api`,
        {
            method: 'POST',
            body: params,
        },
    );
    const result = await r.json();
    if (result.status != '1') {
        throw new Error(`Verification failed: ${result.message}: ${result.result}`);
    }
    console.log(`Successfully verified source code for ${name.bold} on ${network} at ${address.green.bold} (ref: ${result.result})!`);
}

function createCompilerStandardInput(artifact, code) {
    return {
        language: 'Solidity',
        sources: {
            [`${artifact.contractName}.sol`]: {
                content: code,
            },
        },
        settings: { ...artifact.compiler.settings, remappings: undefined },
    };
}
