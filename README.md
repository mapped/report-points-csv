# Requirements

- Node.js 16+

# Installation

- Clone this repo
- Change directory to the repo root
- npm install

# Running

This program has two modes:

### Input File

In this mode you can query data in some other tool and provide the JSON output:

```
node report.js --file INPUT_FILE.json
```

This is the GraphQL query to generate the input file:

```graphql
{
  buildings(filter: { id: { eq: "$BUILDING_ID" } }) {
    things {
      id
      exactType
      name
      description
      firmwareVersion
      mappingKey
      model {
        name
        description
        manufacturer {
          name
          description
        }
      }
      points {
        id
        name
        description
        exactType
        stateTexts
        mappingKey
      }
    }
  }
}
```

### Live Query

The other mode instructs this program to make a GraphQL query. The result is used as input:

This can be done with a PAT

```
node report.js --buildingId $BUILDING_ID --orgId $ORG_ID --pat $MAPPED_PAT
```

Or with a JWT on the command line:

```
node report.js --buildingId $BUILDING_ID --orgId $ORG_ID --jwt $MAPPED_JWT
```

Or with a jwt.txt file in the current working directory

```
node report.js --buildingId $BUILDING_ID --orgId $ORG_ID
```

It will generate an output CSV file in the current working directory.
