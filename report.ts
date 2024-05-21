import { EntityTypeKey } from '@mapped/proto-node-nice/mapped/ontology/entity_type_key/entity_type_key'
import { Ontology } from '@mapped/rivet-proto/dist/ontology'
import { Thing as GraphQlThing } from '@mapped/schema-graph-react-apollo'
import { program } from 'commander'
import { GraphQLClient, gql } from 'graphql-request'
import * as csv from 'csv-parser'

import * as fs from 'fs'

const ROOT_POINT_ENTITY_TYPES = [
  EntityTypeKey.ALARM,
  EntityTypeKey.COMMAND,
  EntityTypeKey.SENSOR,
  EntityTypeKey.PARAMETER,
  EntityTypeKey.SETPOINT,
  EntityTypeKey.STATUS,
  EntityTypeKey.POINT,
]

const ROOT_THING_ENTITY_TYPES = [
  EntityTypeKey.CAMERA,
  EntityTypeKey.ELECTRICAL_EQUIPMENT,
  EntityTypeKey.ELEVATOR,
  EntityTypeKey.FIRE_SAFETY_EQUIPMENT,
  EntityTypeKey.FURNITURE,
  EntityTypeKey.GAS_DISTRIBUTION,
  EntityTypeKey.HVAC_EQUIPMENT,
  EntityTypeKey.LIGHTING_EQUIPMENT,
  EntityTypeKey.METER,
  EntityTypeKey.MOTOR,
  EntityTypeKey.PV_PANEL,
  EntityTypeKey.RELAY,
  EntityTypeKey.SAFETY_EQUIPMENT,
  EntityTypeKey.SECURITY_EQUIPMENT,
  EntityTypeKey.SHADING_EQUIPMENT,
  EntityTypeKey.SOLAR_THERMAL_COLLECTOR,
  EntityTypeKey.STEAM_DISTRIBUTION,
  EntityTypeKey.VALVE,
  EntityTypeKey.WATER_DISTRIBUTION,
  EntityTypeKey.WATER_HEATER,
  EntityTypeKey.WEATHER_STATION,
  EntityTypeKey.OCCUPANCY_SENSING_DEVICE,
  EntityTypeKey.BACNET_DEVICE,
  EntityTypeKey.LIGHTING_CONTROLLER,
  EntityTypeKey.CONTROLLER,
  EntityTypeKey.DEVICE,
]

// The CSV columns in order
const COLUMNS: string[] = [
  'mappedPointId',
  'ip',
  'network',
  'instanceId',
  'objectId',
  'mappedThingId',
  'equipmentName',
  'equipmentDescription',
  'equipmentType',
  'equipmentCategory',
  'equipmentManufacturer',
  'equipmentModel',
  'equipmentFirmware',
  'equipmentLocation',
  // 'equipmentIsPartOf',
  //'equipmentMappingKey',
  // "equipmentDateCreated",
  // "equipmentDateUpdated",
  'pointName',
  'pointDescription',
  'pointType',
  'pointCategory',
  'pointUnit',
  'pointOriginalUnit',
  //'pointValueMap',
  'pointConfidence',
  'pointConfidenceLevel',
  //'pointUnused',
  // "pointDateCreated",
  // "pointDateUpdated",
  // "pointDaysToClassify",
]

// BACnet object types map
const objectTypeMap: { [key: number]: string } = {
  0: 'analog_input',
  1: 'analog_output',
  2: 'analog_value',
  3: 'binary_input',
  4: 'binary_output',
  5: 'binary_value',
  6: 'calendar',
  7: 'command',
  8: 'device',
  9: 'event_enrollment',
  10: 'file',
  11: 'group',
  12: 'loop',
  13: 'multi-state_input',
  14: 'multi-state_output',
  15: 'notification_class',
  16: 'program',
  17: 'schedule',
  18: 'averaging',
  19: 'multi-state_value',
  20: 'trend_log',
  21: 'life_safety_point',
  22: 'life_safety_zone',
  23: 'accumulator',
  24: 'pulse_converter',
}

const POINTS_QUERY = gql`
  query getPoints($buildingId: String!) {
    buildings(filter: { id: { eq: $buildingId } }) {
      things {
        id
        exactType
        name
        description
        firmwareVersion
        mappingKey
        dateCreated
        dateUpdated
        hasLocation {
          name
        }
        isPartOf {
          id
          name
        }
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
          valueMap
          mappingKey
          dateCreated
          dateUpdated
          unused
          unit {
            id
            name
          }
        }
      }
    }
  }
`

const THING_POINTS_QUERY = gql`
  query getThingPoints($thingIds: [String]!) {
    things(filter: { id: { in: $thingIds } }) {
      id
      exactType
      name
      description
      firmwareVersion
      mappingKey
      dateCreated
      dateUpdated
      hasLocation {
        name
      }
      isPartOf {
        id
        name
      }
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
        valueMap
        mappingKey
        dateCreated
        dateUpdated
        unused
        unit {
          id
          name
        }
      }
    }
  }
`

type Report = {
  things: {
    total: number
    byCategory: { [key: string]: number }
  }
  points: {
    total: number
    used: number
    unused: number
    // Map of root entity types to count
    usedByCategory: { [key: string]: number }
  }
}
;(async () => {
  // Parse command line arguments
  program
    .option('--file <file>')
    .option('--orgId <orgId>')
    .option('--buildingId <buildingId>')
    .option('--thingIds <thingIds>')
    .option('--pat <pat>')
    .option('--jwt  <jwt>')
    .option('--confidenceFile  <confidence>')
    .option('--unitCorrectionsFile  <confidence>')

  program.parse()
  const options = program.opts()

  const pointConfidence = await getConfidenceData(options)
  console.log(`Found ${Object.keys(pointConfidence).length} confidence entries`)

  const unitCorrections = await getUnitCorrections(options)
  console.log(`Found ${Object.keys(unitCorrections).length} unit corrections`)

  let d: any

  if (fs.existsSync('./jwt.txt')) {
    options.jwt = fs.readFileSync('./jwt.txt', 'utf8')
  }

  if (options.file) {
    // Input data can come from a file or by making a graphql query
    d = getFileData(options).data
  } else if (options.pat || options.jwt) {
    d = await getGraphQlData(options)
  } else {
    console.error('Must specify either --file or --pat or --jwt')
    process.exit(1)
  }

  // Resolve and open output file
  fs.mkdirSync(__dirname + '/data', { recursive: true })
  const outClassifiedFile = __dirname + `/data/report.${new Date().getTime()}.csv`
  const outUnclassifiedFile = __dirname + `/data/report.${new Date().getTime()}.pending.csv`
  var outClassified = fs.createWriteStream(outClassifiedFile)
  var outUnclassified = fs.createWriteStream(outUnclassifiedFile)

  // Write column header
  outClassified.write(COLUMNS.join(',') + '\n')
  outUnclassified.write(COLUMNS.join(',') + '\n')

  const report: Report = {
    things: {
      total: 0,
      byCategory: {},
    },
    points: {
      total: 0,
      used: 0,
      unused: 0,
      usedByCategory: {},
    },
  }

  console.log(`Found ${d.things.length} things`)

  d.things.forEach((thing: GraphQlThing) => {
    report.things.total++

    let equipmentCategory: string | undefined = undefined

    try {
      const thingEntityType = thing.exactType!.toUpperCase() as EntityTypeKey
      const parents = [thingEntityType].concat(Ontology.resolveEntity(thingEntityType).getParentEntityTypeKeys())

      for (const rootThingEntityType of ROOT_THING_ENTITY_TYPES) {
        if (parents.includes(rootThingEntityType)) {
          equipmentCategory = EntityTypeKey[rootThingEntityType]
          report.things.byCategory[equipmentCategory] = (report.things.byCategory[equipmentCategory] || 0) + 1
          break
        }
      }
    } catch (e) {
      console.error(`Error resolving entity type for ${thing.exactType}`)
    }

    if (!equipmentCategory) {
      console.error(`Could not resolve thing type ${thing.exactType}`)
    }

    const points = thing.points
    if (!points) {
      return
    }
    points
      .map((point) => {
        // Remap to remove the Maybe
        return point!
      })
      .forEach((point) => {
        report.points.total++

        // Initialize the row with this data
        const row: { [key: string]: string | null | undefined } = {}
        if (thing.mappingKey!.includes('@MAPPED_UG/')) {
          const mappingKey = parseThingMappingKey(thing.mappingKey!)
          row.network = mappingKey.network
          row.instanceId = mappingKey.instanceId
          row.ip = mappingKey.ip
        }
        row.mappedThingId = thing.id
        row.equipmentName = thing.name
        row.equipmentDescription = thing.description
        row.equipmentType = thing.exactType
        row.equipmentCategory = equipmentCategory
        row.equipmentManufacturer = thing.model?.manufacturer?.name
        row.equipmentModel = thing?.model?.name
        row.equipmentFirmware = thing.firmwareVersion
        row.equipmentDateCreated = thing.dateCreated
        row.equipmentDateUpdated = thing.dateUpdated
        row.equipmentLocation = thing.hasLocation ? thing.hasLocation.name : ''
        row.equipmentIsPartOf =
          thing.isPartOf!.length > 0 ? `${thing?.isPartOf![0]!.name} (${thing?.isPartOf![0]!.id})` : ''
        row.equipmentMappingKey = thing.mappingKey

        row.mappedPointId = point.id
        row.pointName = point.name
        row.pointDescription = point.description
        row.pointType = point.exactType
        row.pointUnused = pointConfidence[point.id]?.unused ? 'true' : 'false'

        const unused = row.pointUnused === 'true'

        if (unused) {
          report.points.unused++
        } else {
          report.points.used++
          try {
            const pointEntityType = point.exactType!.toUpperCase() as EntityTypeKey
            const parents = [pointEntityType].concat(Ontology.resolveEntity(pointEntityType).getParentEntityTypeKeys())

            for (const rootPointEntityType of ROOT_POINT_ENTITY_TYPES) {
              if (parents.includes(rootPointEntityType)) {
                row.pointCategory = EntityTypeKey[rootPointEntityType]
                report.points.usedByCategory[row.pointCategory] =
                  (report.points.usedByCategory[row.pointCategory] || 0) + 1
                break
              }
            }
          } catch (e) {
            console.error(`Error resolving entity type for ${point.exactType}`)
          }
          if (!row.pointCategory) {
            console.error(`Could not resolve point type ${point.exactType}`)
          }
        }

        row.pointDateCreated = point.dateCreated
        row.pointDateUpdated = point.dateUpdated
        row.pointDaysToClassify = (
          (new Date(row.pointDateUpdated!).getTime() - new Date(row.equipmentDateUpdated!).getTime()) /
          1000 /
          60 /
          60 /
          24
        ).toString()
        row.pointValueMap = point.valueMap != null ? encodeURIComponent(JSON.stringify(point.valueMap)) : ''

        if (point.unit && point.unit.id != 'NO_UNIT') {
          row.pointUnit = point.unit.id
        }

        if (unitCorrections[point.id]) {
          row.pointOriginalUnit = unitCorrections[point.id].previousUnit
        }

        row.pointConfidence = pointConfidence[point.id]?.type_confidence || ''
        row.pointConfidenceLevel = pointConfidence[point.id]?.confidence_level || ''

        if (point.mappingKey!.includes('MAPPED_UG')) {
          const parsedMappingKey = parsePointMappingKey(point.mappingKey!)

          if (parsedMappingKey) {
            // Split the object ID that looks something like 5:65
            const objectIdParts = parsedMappingKey.objectId.split(':')

            // Set bacnet object type and instance
            row.objectId = `${objectTypeMap[parseInt(objectIdParts[0])] || 'other'}/${objectIdParts[1]}`
          }
        }

        if (unused || row.pointType === 'Point') {
          outUnclassified.write(rowToCsv(row) + '\n')
        } else {
          outClassified.write(rowToCsv(row) + '\n')
        }
      })
  })

  console.log(JSON.stringify(report, null, 2))

  // Example: msrc://CONYEjT9KGC7AAUkR4GisCkYD@MAPPED_UG/GWVK4aP7uRD5NRianS5PjHnt/10.135.40.6:48808/1220417
  function parseThingMappingKey(key: string) {
    const parts = key.split('/')
    const ipAndPort = parts[4] // 10.135.40.6:48808
    const ip = ipAndPort.split(':')[0] // 10.135.40.6
    const network = ipAndPort.split(':')[1] // 48808
    const instanceId = parts[5]
    return {
      network,
      instanceId,
      ip,
    }
  }

  // Example: msrc://CONYEjT9KGC7AAUkR4GisCkYD@MAPPED_UG/GWVK4aP7uRD5NRianS5PjHnt/10.135.40.6:48808/1220417?object=3:11
  function parsePointMappingKey(key: string) {
    try {
      const parts = key.split('/')
      const objectId = parts[5].split('=')[1] // 1220417?object=3:11
      return {
        objectId,
      }
    } catch (e) {
      // NOOP
      return null
    }
  }

  function rowToCsv(row: { [key: string]: string | null | undefined }) {
    return COLUMNS.map((key) => {
      let value = row[key] || ''
      // Replace double quotes with double double quotes
      if (Object.prototype.toString.call(value) === '[object String]' && value.includes(`"`)) {
        value = `"${value.replace(/"/g, '""')}"`
      }
      return `"${row[key] || ''}"`
    }).join(',')
  }

  function getFileData(options: any) {
    const file = options.file
    console.log('Reading file:', file)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  async function getGraphQlData(options: any) {
    let jwt = options.jwt
    let pat = options.pat

    if (jwt) {
      console.log('Using JWT')
    } else if (pat) {
      console.log('Using PAT')
    } else {
      console.error('JWT or PAT is required')
      process.exit(1)
    }

    // Building ID is required when making graphql query
    const buildingId = options.buildingId
    if (!buildingId && !options.thingIds) {
      console.error('Must specify --buildingId or --thingIds')
      process.exit(1)
    }

    console.log('Making graphql query')

    const auth = resolveAuthHeader(options)
    const client = new GraphQLClient('https://api.mapped.com/graphql', {
      headers: {
        Authorization: auth,
        'X-Mapped-Org-Id': options.orgId,
      },
    })

    if (options.thingIds) {
      return await client.request(THING_POINTS_QUERY, {
        thingIds: options.thingIds.split(','),
      })
    } else {
      return (
        await client.request(POINTS_QUERY, {
          buildingId,
        })
      ).buildings[0]
    }
  }

  function resolveAuthHeader(options: any) {
    let auth = ''
    if (options.pat) {
      auth = `token ${options.pat}`
    } else if (options.jwt) {
      auth = `Bearer ${options.jwt}`
    } else {
      console.error('JWT or PAT is required')
      process.exit(1)
    }
    return auth
  }
})()

type PointConfidenceMap = {
  [key: string]: { type_confidence: string; confidence_level: string; unused: boolean }
}

function getConfidenceData(options: any): Promise<PointConfidenceMap> {
  return new Promise((resolve, reject) => {
    let pointConfidence: PointConfidenceMap = {}

    if (options.confidenceFile) {
      fs.createReadStream(options.confidenceFile)
        .pipe(csv.default())
        .on('data', (data) => {
          pointConfidence[data.id] = {
            type_confidence: data.type_confidence,
            confidence_level: data.confidence_level,
            unused: data.unused === 'True',
          }
        })
        .on('end', () => {
          resolve(pointConfidence)
        })
    } else {
      resolve(pointConfidence)
    }
  })
}

function getUnitCorrections(options: any): Promise<{ [key: string]: { previousUnit: string } }> {
  return new Promise((resolve, reject) => {
    let unitCorrections: { [key: string]: { previousUnit: string } } = {}

    if (options.unitCorrectionsFile) {
      fs.createReadStream(options.unitCorrectionsFile)
        .pipe(csv.default())
        .on('data', (data) => {
          unitCorrections[data.id] = {
            previousUnit: data.prev_unit,
          }
        })
        .on('end', () => {
          resolve(unitCorrections)
        })
    } else {
      resolve(unitCorrections)
    }
  })
}
