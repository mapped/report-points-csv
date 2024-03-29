const fs = require("fs");
const { program } = require("commander");
const { GraphQLClient, gql } = require("graphql-request");

// The CSV columns in order
const COLUMNS = [
  "mappedThingId",
  "ip",
  "network",
  "instanceId",
  "equipmentName",
  "equipmentDescription",
  "equipmentType",
  "equipmentManufacturer",
  "equipmentModel",
  "equipmentFirmware",
  "equipmentLocation",
  "equipmentIsPartOf",
  "equipmentMappingKey",
  "pointCount",
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
  const outFile = __dirname + `/data/thing-report.${new Date().getTime()}.csv`;
  var out = fs.createWriteStream(outFile);

  // Write column header
  out.write(COLUMNS.join(",") + "\n");

  d.buildings[0].things.forEach((thing) => {
    // Initialize the row with this data
    const row = {};
    if (thing.mappingKey.includes("@MAPPED_UG/")) {
      const mappingKey = parseThingMappingKey(thing.mappingKey);
      row.network = mappingKey.network;
      row.instanceId = mappingKey.instanceId;
      row.ip = mappingKey.ip;
    }
    row.mappedThingId = thing.id;
    row.equipmentName = thing.name;
    row.equipmentDescription = thing.description;
    row.equipmentType = thing.exactType;
    row.equipmentManufacturer = thing.model?.manufacturer?.name;
    row.equipmentModel = thing?.model?.name;
    row.equipmentFirmware = thing.firmwareVersion;
    row.equipmentLocation = thing.hasLocation ? thing.hasLocation.name : "";
    row.equipmentIsPartOf =
      thing.isPartOf.length > 0
        ? `${thing.isPartOf[0].name} (${thing.isPartOf[0].id})`
        : "";
    row.equipmentMappingKey = thing.mappingKey;
    row.pointCount = thing.points.length;
    out.write(rowToCsv(row) + "\n");
  });

  // Example: msrc://CONYEjT9KGC7AAUkR4GisCkYD@MAPPED_UG/GWVK4aP7uRD5NRianS5PjHnt/10.135.40.6:48808/1220417
  function parseThingMappingKey(key) {
    const parts = key.split("/");
    const ipAndPort = parts[4]; // 10.135.40.6:48808
    const ip = ipAndPort.split(":")[0]; // 10.135.40.6
    const network = ipAndPort.split(":")[1]; // 48808
    const instanceId = parts[5];
    return {
      network,
      instanceId,
      ip,
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
