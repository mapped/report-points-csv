const fs = require("fs");
const { program } = require("commander");
const { GraphQLClient, gql } = require("graphql-request");

// The CSV columns in order
const COLUMNS = [
  "mappedPointId",
  "network",
  "instanceId",
  "objectId",
  "mappedThingId",
  "equipmentName",
  "equipmentDescription",
  "equipmentType",
  "equipmentManufacturer",
  "equipmentModel",
  "equipmentFirmware",
  "equipmentLocation",
  "pointName",
  "pointDescription",
  "pointType",
  "pointUnit",
  "pointStateTexts",
];

// BACnet object types map
const objectTypeMap = {
  0: "analog_input",
  1: "analog_output",
  2: "analog_value",
  3: "binary_input",
  4: "binary_output",
  5: "binary_value",
  6: "calendar",
  7: "command",
  8: "device",
  9: "event_enrollment",
  10: "file",
  11: "group",
  12: "loop",
  13: "multi-state_input",
  14: "multi-state_output",
  15: "notification_class",
  16: "program",
  17: "schedule",
  18: "averaging",
  19: "multi-state_value",
  20: "trend_log",
  21: "life_safety_point",
  22: "life_safety_zone",
  23: "accumulator",
  24: "pulse_converter",
};

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
        hasLocation {
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
          stateTexts
          mappingKey
          unit {
            id
          }
        }
      }
    }
  }
`;

(async () => {
  // Parse command line arguments
  program
    .option("--file <file>")
    .option("--orgId <orgId>")
    .option("--buildingId <buildingId>")
    .option("--pat <pat>")
    .option("--jwt  <jwt>");
  program.parse();
  const options = program.opts();

  let d;

  if (fs.existsSync("./jwt.txt")) {
    options.jwt = fs.readFileSync("./jwt.txt", "utf8");
  }

  if (options.file) {
    // Input data can come from a file or by making a graphql query
    d = getFileData(options).data;
  } else if (options.pat || options.jwt) {
    d = await getGraphQlData(options);
  } else {
    console.error("Must specify either --file or --pat or --jwt");
    process.exit(1);
  }

  // Resolve and open output file
  fs.mkdirSync(__dirname + "/data", { recursive: true });
  const outClassifiedFile =
    __dirname + `/data/report.${new Date().getTime()}.csv`;
  const outUnclassifiedFile =
    __dirname + `/data/report.${new Date().getTime()}.pending.csv`;
  var outClassified = fs.createWriteStream(outClassifiedFile);
  var outUnclassified = fs.createWriteStream(outUnclassifiedFile);

  // Write column header
  outClassified.write(COLUMNS.join(",") + "\n");
  outUnclassified.write(COLUMNS.join(",") + "\n");

  d.buildings[0].things.forEach((thing) => {
    thing.points.forEach((point) => {
      // Initialize the row with this data
      const row = {};
      const mappingKey = parseThingMappingKey(thing.mappingKey);
      row.network = mappingKey.network;
      row.instanceId = mappingKey.instanceId;
      row.mappedThingId = thing.id;
      row.equipmentName = thing.name;
      row.equipmentDescription = thing.description;
      row.equipmentType = thing.exactType;
      row.equipmentManufacturer = thing.model.manufacturer.name;
      row.equipmentModel = thing.model.name;
      row.equipmentFirmware = thing.firmwareVersion;
      row.equipmentLocation = thing.hasLocation ? thing.hasLocation.name : "";

      // Split the object ID that looks something like 5:65
      const objectIdParts = parsePointMappingKey(
        point.mappingKey
      ).objectId.split(":");

      row.mappedPointId = point.id;
      row.objectId = `${objectTypeMap[parseInt(objectIdParts[0])] || "other"}/${
        objectIdParts[1]
      }`;
      row.pointName = point.name;
      row.pointDescription = point.description;
      row.pointType = point.exactType;
      row.pointStateTexts =
        point.stateTexts != null ? point.stateTexts.join(",") : "";

      if (point.unit && point.unit.id != "NO_UNIT") {
        row.pointUnit = point.unit.id;
      }
      if (row.pointType === "Point") {
        outUnclassified.write(rowToCsv(row) + "\n");
      } else {
        outClassified.write(rowToCsv(row) + "\n");
      }
    });
  });

  // Example: msrc://CONYEjT9KGC7AAUkR4GisCkYD@MAPPED_UG/GWVK4aP7uRD5NRianS5PjHnt/10.135.40.6:48808/1220417
  function parseThingMappingKey(key) {
    const parts = key.split("/");
    const ipAndPort = parts[4]; // 10.135.40.6:48808
    const network = ipAndPort.split(":")[1]; // 48808
    const instanceId = parts[5];
    return {
      network,
      instanceId,
    };
  }

  // Example: msrc://CONYEjT9KGC7AAUkR4GisCkYD@MAPPED_UG/GWVK4aP7uRD5NRianS5PjHnt/10.135.40.6:48808/1220417?object=3:11
  function parsePointMappingKey(key) {
    const parts = key.split("/");
    const objectId = parts[5].split("=")[1]; // 1220417?object=3:11
    return {
      objectId,
    };
  }

  function rowToCsv(row) {
    return COLUMNS.map((key) => `"${row[key] || ""}"`).join(",");
  }

  function getFileData(options) {
    const file = options.file;
    console.log("Reading file:", file);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  async function getGraphQlData(options) {
    let jwt = options.jwt;
    let pat = options.pat;

    if (jwt) {
      console.log("Using JWT");
    } else if (pat) {
      console.log("Using PAT");
    } else {
      console.error("JWT or PAT is required");
      process.exit(1);
    }

    // Building ID is required when making graphql query
    const buildingId = options.buildingId;
    if (!buildingId) {
      console.error("Must specify --buildingId");
      process.exit(1);
    }

    console.log("Making graphql query");

    const auth = resolveAuthHeader(options);
    const client = new GraphQLClient("https://api.mapped.com/graphql", {
      headers: {
        Authorization: auth,
        "X-Mapped-Org-Id": options.orgId,
      },
    });
    return await client.request(POINTS_QUERY, {
      buildingId,
    });
  }

  function resolveAuthHeader(options) {
    let auth = "";
    if (options.pat) {
      auth = `token ${options.pat}`;
    } else if (options.jwt) {
      auth = `Bearer ${options.jwt}`;
    } else {
      console.error("JWT or PAT is required");
      process.exit(1);
    }
    return auth;
  }
})();
