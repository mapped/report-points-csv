# Requirements

- Node.js 16+
- ASSUMES A POSIX COMPATIBLE FILE SYSTEM. Native windows paths are curretly not supported.

# Installation

- Clone this repo
- Change directory to the repo root
- npm install

# Running

With a PAT

```
node report.js --buildingId $BUILDING_ID --orgId $ORG_ID --pat $MAPPED_PAT
```

With a JWT

```
node report.js --buildingId $BUILDING_ID --orgId $ORG_ID --jwt $MAPPED_JWT
```

Or with a jwt.txt file in the current working directory

```
node report.js --buildingId $BUILDING_ID --orgId $ORG_ID
```

It will generate an output CSV file in the current working directory.

### Limitations

- isPartOf is limited to a single parent
