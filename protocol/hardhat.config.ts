import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import '@dotenvx/dotenvx/config';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY not set — run: dotenvx run -- <command>');

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs   : 200,
      },
      viaIR: false,
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url    : 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    // Celo Sepolia — long-term testnet, chain 11142220
    celoSepolia: {
      url        : process.env.CELO_SEPOLIA_RPC ?? 'https://forno.celo-sepolia.celo-testnet.org',
      chainId    : 11142220,
      accounts   : [PRIVATE_KEY],
      gasPrice   : 'auto',
    },
    celo: {
      url        : process.env.CELO_RPC ?? 'https://forno.celo.org',
      chainId    : 42220,
      accounts   : [PRIVATE_KEY],
      gasPrice   : 'auto',
    },
  },

  // Optional: source verification on Celoscan
  etherscan: {
    apiKey: {
      celoSepolia : process.env.CELOSCAN_API_KEY ?? '',
      celo        : process.env.CELOSCAN_API_KEY ?? '',
    },
    customChains: [
      {
        // Blockscout is the explorer for Celo Sepolia (no Celoscan yet)
        network   : 'celoSepolia',
        chainId   : 11142220,
        urls      : {
          apiURL    : 'https://celo-sepolia.blockscout.com/api',
          browserURL: 'https://celo-sepolia.blockscout.com',
        },
      },
      {
        network   : 'celo',
        chainId   : 42220,
        urls      : {
          apiURL    : 'https://api.celoscan.io/api',
          browserURL: 'https://celoscan.io',
        },
      },
    ],
  },

  paths: {
    sources : './contracts',
    tests   : './test',
    cache   : './cache',
    artifacts: './artifacts',
  },

  typechain: {
    outDir : 'typechain-types',
    target : 'ethers-v6',
  },
};

export default config;
