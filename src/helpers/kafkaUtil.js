const { Kafka } = require("kafkajs");
const kafka = new Kafka({
  clientId: "api",
  brokers: ["127.0.0.1:9092"],
});
const _ = require("lodash");
var logger = require("sb_logger_util_v2");
const envVariables = require("../envVariables");
const consumer = kafka.consumer({ groupId: "api-group" });
consumer.connect();

const { queue } = require("../service/schedulerService");

const sendRecord = async (data, callback) => {
  if (_.isEmpty(data)) {
    logger.error({
      msg: "Data must be provided to send Record",
      additionalInfo: { data },
    });
    return callback(new Error("Event Data must be provided."));
  }

  const record = [
    {
      topic: data.topic,
      messages: [{ key: "VALUE", value: data.data }],
    },
  ];
  logger.info({ msg: "Kafka record", additionalInfo: { record } });
  await data.kafka.producer().send(record);
};

const KafkaService = {
  sendRecord: sendRecord,

  addTransformer: async (transformer) => {
    const admin = kafka.admin();
    await admin.connect();

    try {
      const topicsToCreate = [
        {
          topic: transformer.name,
        },
      ];
      return await admin.createTopics({
        topics: topicsToCreate,
      });
    } catch (e) {
      console.error("Error occured in creating topic", e);
      return undefined;
    }
  },

  refreshSubscribers: async (transformers) => {
    for (let i = 0; i < transformers.length; i++) {
      let topic = transformers[i].name;
      await consumer.subscribe({ topic, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const { Transformer } = require("../models/transformer");
          const { Service } = require("../models/service");
          const data = message.value.toString();
          const transformer = await Transformer.query().where("name", topic);
          console.log({ transformer });
          const service = await Service.query().findById(
            transformer[0].service
          );
          queue.add(
            service.type,
            {
              transformer,
              service,
              data,
              sendRecord,
              kafka,
            },
            {
              attempts: service.cadence.retries + 1,
              backoff: {
                type: "fixed",
                delay: 1000 * parseInt(service.cadence["retries-interval"]),
              },
            }
          );
          console.log("Scheduled Successfully");
        },
      });
    }
  },
};

module.exports = KafkaService;